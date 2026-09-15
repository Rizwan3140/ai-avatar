"""Hearing Indian languages on this machine — AI4Bharat's IndicConformer.

Whisper was the local fallback, and on Telugu it is not one: measured on clean
speech, `medium` took 14 to 112 seconds a clip and wrote Khmer. IndicConformer
(600M, MIT) wrote the same clips near word-perfect in 0.3-0.5s — on the CPU,
which is why this needs no GPU and no second process.

**No torch.** The published model is ONNX except for one TorchScript file that
turns audio into a log-mel spectrogram, plus a decoding loop written against
torch tensors. Both are small and fixed, so they are ported to numpy below and
checked against the original by `demo()`. That keeps the app on the
`onnxruntime` it already has — pulling a 3 GB PyTorch into the kiosk to compute
one spectrogram would be the dependency this project exists to avoid.

**Everything English comes out in Telugu script** — "black palazzo pant" is
heard as "బ్లాక్ పలాజో పాంట్". That is correct transcription and useless as a
catalog query, so `/api/chat` translates non-English turns for search; see
`llm.search_text`.

The weights are gated on Hugging Face (accept the terms once, set HF_TOKEN) and
fetched with `python -m backend.indic_asr download`. A machine without them
falls back to Sarvam, then Whisper.
"""

import json
import sys
import threading
from pathlib import Path

import numpy as np

REPO = "ai4bharat/indic-conformer-600m-multilingual"
SAMPLE_RATE = 16000

#: The avatar's locale -> the model's language key. Odia is `or` here and
#: `od-IN` at Sarvam; the rest are the part before the dash.
LANGUAGES = {
    f"{code}-IN": code
    for code in ("as", "bn", "gu", "hi", "kn", "ml", "mr", "ne", "pa", "sa", "ta", "te", "ur")
}
LANGUAGES["od-IN"] = "or"

# From the model's config.json.
_BLANK = 256
_MAX_SYMBOLS = 10
_PRED_LAYERS, _PRED_HIDDEN = 2, 640

# From its preprocessor.ts, read out of the TorchScript constants.
_N_FFT, _HOP, _WIN, _N_MELS = 512, 160, 400, 80
_PREEMPH = 0.97
_LOG_GUARD = 2.0 ** -24
_STD_EPS = 1e-5


class Unavailable(RuntimeError):
    """The weights are not on this machine. The caller moves on to Sarvam."""


def _hz_to_mel(f):
    f = np.asarray(f, dtype=np.float64)
    linear = f * 3.0 / 200.0
    logstep = np.log(6.4) / 27.0
    return np.where(f >= 1000.0, 15.0 + np.log(np.maximum(f, 1000.0) / 1000.0) / logstep, linear)


def _mel_to_hz(m):
    m = np.asarray(m, dtype=np.float64)
    logstep = np.log(6.4) / 27.0
    return np.where(m >= 15.0, 1000.0 * np.exp(logstep * (m - 15.0)), m * 200.0 / 3.0)


def _mel_filters() -> np.ndarray:
    """Slaney-normalised triangles, 0-8 kHz — librosa's `mel()` defaults, which
    is what NeMo built the original from. (257, 80)."""
    freqs = np.linspace(0, SAMPLE_RATE / 2, _N_FFT // 2 + 1)
    edges = _mel_to_hz(np.linspace(_hz_to_mel(0.0), _hz_to_mel(SAMPLE_RATE / 2), _N_MELS + 2))
    ramps = np.subtract.outer(edges, freqs)
    widths = np.diff(edges)
    lower = -ramps[:-2] / widths[:-1, None]
    upper = ramps[2:] / widths[1:, None]
    weights = np.maximum(0.0, np.minimum(lower, upper))
    weights *= (2.0 / (edges[2:] - edges[:-2]))[:, None]
    return weights.T


_FILTERS = _mel_filters().astype(np.float32)
_WINDOW = np.zeros(_N_FFT, dtype=np.float32)
_WINDOW[(_N_FFT - _WIN) // 2 : (_N_FFT - _WIN) // 2 + _WIN] = np.hanning(_WIN)  # symmetric, as torch's was


def features(audio: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """16 kHz mono float32 -> the encoder's input, (1, 80, frames) and length."""
    audio = np.asarray(audio, dtype=np.float32)
    frames = len(audio) // _HOP + 1
    emphasised = np.concatenate([audio[:1], audio[1:] - _PREEMPH * audio[:-1]])
    padded = np.pad(emphasised, _N_FFT // 2, mode="reflect")
    strides = np.lib.stride_tricks.sliding_window_view(padded, _N_FFT)[::_HOP][:frames]
    spectrum = np.fft.rfft(strides * _WINDOW, axis=-1)  # torch.stft(normalized=False)
    power = (spectrum.real**2 + spectrum.imag**2).astype(np.float32)
    logmel = np.log(power @ _FILTERS + _LOG_GUARD).T  # (80, frames)
    mean = logmel.mean(axis=1, keepdims=True)
    var = ((logmel - mean) ** 2).sum(axis=1, keepdims=True) / (frames - 1)
    std = np.sqrt(np.maximum(var, 5.960464477539063e-08))
    normalised = (logmel - mean) / (std + _STD_EPS)
    return normalised[None].astype(np.float32), np.array([frames], dtype=np.int64)


_sessions: dict = {}
_vocab: dict = {}
_lock = threading.Lock()


def _folder(download: bool = False) -> Path:
    from huggingface_hub import snapshot_download

    try:
        return Path(snapshot_download(REPO, local_files_only=not download))
    except Exception as exc:
        raise Unavailable(
            f"IndicConformer is not on this machine ({type(exc).__name__}). Accept the "
            f"terms at huggingface.co/{REPO}, set HF_TOKEN, and run "
            "`python -m backend.indic_asr download`."
        ) from exc


def _session(name: str):
    """One ONNX graph, loaded the first time anything needs it. Only the
    requested language's output head is loaded, not all twenty-two."""
    with _lock:
        if name not in _sessions:
            try:
                import onnxruntime as ort
            except (ImportError, OSError) as exc:
                # On Windows without the VC++ runtime this is "DLL load failed",
                # and a reinstall of onnxruntime brings it back. Hearing moves on
                # to Sarvam rather than the turn failing. See CLAUDE.md.
                raise Unavailable(f"onnxruntime will not load here ({exc})") from exc

            folder = _folder() / "assets"
            if not _vocab:
                _vocab["tokens"] = json.loads((folder / "vocab.json").read_text(encoding="utf-8"))
            _sessions[name] = ort.InferenceSession(
                str(folder / f"{name}.onnx"), providers=["CPUExecutionProvider"]
            )
        return _sessions[name]


def installed() -> bool:
    try:
        _folder()
        return True
    except Unavailable:
        return False


def hears(language: str) -> bool:
    return language in LANGUAGES


def warm(language: str = "te-IN") -> None:
    """Load before the first visitor. About five seconds; silent when absent."""
    if not hears(language):
        return
    try:
        for name in ("encoder", "rnnt_decoder", "joint_enc", "joint_pred", "joint_pre_net"):
            _session(name)
        _session(f"joint_post_net_{LANGUAGES[language]}")
    except Unavailable:
        pass


def _pcm(audio: bytes) -> np.ndarray:
    """Whatever the browser sent, as 16 kHz mono float32. PyAV is already here
    for the voice upload, and decodes a WAV header as readily as an MP3."""
    import io

    import av
    from av.audio.resampler import AudioResampler

    chunks = []
    with av.open(io.BytesIO(audio)) as container:
        stream = next(s for s in container.streams if s.type == "audio")
        resampler = AudioResampler(format="flt", layout="mono", rate=SAMPLE_RATE)
        for frame in container.decode(stream):
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray().reshape(-1))
        for out in resampler.resample(None):
            chunks.append(out.to_ndarray().reshape(-1))
    return np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)


def recognise(samples: np.ndarray, language: str) -> str:
    """16 kHz float32 in, text out. RNN-T greedy decoding — measured a little
    more accurate than the CTC head on the same clips, at the same speed."""
    lang = LANGUAGES[language]
    if len(samples) < _N_FFT:
        return ""
    signal, length = features(samples)
    encoded = _session("encoder").run(
        ["outputs", "encoded_lengths"], {"audio_signal": signal, "length": length}
    )[0]
    joint_enc = _session("joint_enc").run(["output"], {"input": encoded.transpose(0, 2, 1)})[0]
    decoder, joint_pred = _session("rnnt_decoder"), _session("joint_pred")
    pre_net, post_net = _session("joint_pre_net"), _session(f"joint_post_net_{lang}")

    tokens = [_BLANK]  # the start symbol is the blank id in this model
    state = (
        np.zeros((_PRED_LAYERS, 1, _PRED_HIDDEN), dtype=np.float32),
        np.zeros((_PRED_LAYERS, 1, _PRED_HIDDEN), dtype=np.float32),
    )
    for t in range(joint_enc.shape[1]):
        frame = joint_enc[:, t : t + 1, :]
        for _ in range(_MAX_SYMBOLS):
            g, _, h, c = decoder.run(
                ["outputs", "prednet_lengths", "states", "162"],
                {
                    "targets": np.array([[tokens[-1]]], dtype=np.int32),
                    "target_length": np.array([1], dtype=np.int32),
                    "states.1": state[0],
                    "onnx::Slice_3": state[1],
                },
            )
            g = joint_pred.run(["output"], {"input": g.transpose(0, 2, 1)})[0]
            hidden = pre_net.run(["output"], {"input": frame + g})[0]
            token = int(np.argmax(post_net.run(["output"], {"input": hidden})[0]))
            if token == _BLANK:
                break
            tokens.append(token)
            state = (h, c)

    vocab = _vocab["tokens"][lang]
    return "".join(vocab[t] for t in tokens[1:]).replace("▁", " ").strip()


def transcribe(audio: bytes, language: str) -> str:
    """One visitor turn, as text in the language's own script."""
    return recognise(_pcm(audio), language)


def demo(scratch: str = "") -> None:
    """Runnable check: `python -m backend.indic_asr [folder]`.

    Always: the port of the spectrogram's pieces. With a folder holding the
    reference `<clip>.16k.npy` / `.feats.npy` saved from the original TorchScript
    model and `indic_ref.json` of its transcripts, also the whole pipeline
    against those — the check that the numpy version *is* the model.
    """
    assert hears("te-IN") and hears("hi-IN") and not hears("en-US")
    assert LANGUAGES["od-IN"] == "or"
    assert _FILTERS.shape == (257, 80)
    # Slaney normalisation: every triangle has area 2/(width in Hz) - so the
    # first filter's weights sum to a known value, which was read off the original.
    assert abs(float(_FILTERS[:, 0].sum()) - 0.03117227) < 1e-6, _FILTERS[:, 0].sum()
    assert abs(float(_WINDOW.sum()) - 199.5) < 1e-3
    feats, length = features(np.zeros(16000, dtype=np.float32))
    assert feats.shape == (1, 80, 101) and int(length[0]) == 101
    assert recognise(np.zeros(100, dtype=np.float32), "te-IN") == "", "too short to be speech"

    if scratch:
        folder = Path(scratch)
        reference = json.loads((folder / "indic_ref.json").read_text(encoding="utf-8"))
        for clip, expected in reference.items():
            samples = np.load(folder / f"{clip}.16k.npy")
            mine = features(samples)[0]
            theirs = np.load(folder / f"{clip}.feats.npy")
            err = float(np.abs(mine - theirs).max())
            assert mine.shape == theirs.shape and err < 1e-3, (clip, mine.shape, theirs.shape, err)
            heard = recognise(samples, "te-IN")
            assert heard == expected, (clip, heard, expected)
            print(f"  {clip}: features within {err:.1e}, transcript identical")

    print("indic_asr: ok")


if __name__ == "__main__":
    if sys.argv[1:2] == ["download"]:
        print(_folder(download=True))
    else:
        demo(sys.argv[1] if len(sys.argv) > 1 else "")
