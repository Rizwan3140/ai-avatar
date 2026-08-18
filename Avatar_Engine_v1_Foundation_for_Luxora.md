# Avatar Engine v1 -- Foundation for Luxora

## Vision

Build a **hyper-realistic, voice-to-voice AI Digital Human** that feels
like talking to a real showroom representative.

This project is **not** Luxora yet.

This project is **not** a chatbot.

This project is the **Avatar Engine**, which will later become the
foundation of the Luxora AI Showroom Platform.

------------------------------------------------------------------------

# Primary Goal

Create an AI-powered Digital Human capable of natural real-time
conversations.

A person should walk up to the display and immediately feel like they
are talking to another human.

The avatar is the product.

Everything else comes later.

------------------------------------------------------------------------

# Development Philosophy

## YAGNI

Build only what is required for Version 1.

## KISS

Keep the architecture clean, modular and maintainable.

## SOLID

Every major system should be independent and replaceable.

------------------------------------------------------------------------

# Version 1 Scope

Included:

-   One realistic avatar
-   Voice-to-Voice conversation
-   Browser Speech Recognition
-   Streaming AI responses
-   Browser Text-to-Speech
-   Talking avatar
-   Interruptions (barge-in)
-   Idle animations
-   Listening state
-   Thinking state
-   Speaking state
-   End conversation
-   Minimal white UI

------------------------------------------------------------------------

# Explicitly NOT Included

-   Product showcase
-   Product search
-   Website crawling
-   CSV extraction
-   Vector database
-   Company avatar creation
-   Multiple avatars
-   Authentication
-   Admin dashboard
-   Analytics
-   Database

------------------------------------------------------------------------

# Recommended Free Stack

## Frontend

-   React
-   TypeScript
-   Vite
-   Tailwind CSS
-   Framer Motion
-   Zustand

## Speech Recognition

Browser Web Speech API

## LLM

Gemini 2.5 Flash (Free Tier)

Design the architecture so Gemini can later be replaced with Claude.

## Text-to-Speech

Browser SpeechSynthesis API

------------------------------------------------------------------------

# Architecture

``` text
User
  ↓
Speech Recognition
  ↓
Conversation Manager
  ↓
Gemini Streaming
  ↓
Text-to-Speech
  ↓
Avatar Animation Engine
  ↓
Display
```

------------------------------------------------------------------------

# Folder Structure

``` text
src/
├── avatar/
├── conversation/
├── speech/
├── tts/
├── animations/
├── hooks/
├── services/
├── components/
├── assets/
├── store/
├── types/
└── utils/
```

------------------------------------------------------------------------

# Conversation Flow

``` text
Idle
↓
User presses microphone
↓
Listening
↓
Speech Recognition
↓
Thinking
↓
Gemini streams response
↓
Speech starts immediately
↓
Avatar speaks
↓
User interrupts
↓
Listening resumes
↓
Conversation continues
↓
End Conversation
↓
Idle
```

------------------------------------------------------------------------

# Avatar States

## Idle

-   Breathing
-   Blinking
-   Small head movement
-   Eye movement

## Listening

-   Eye contact
-   Blue microphone glow
-   Slight forward lean

## Thinking

-   Small pause
-   Eyes drift upward
-   Subtle thinking particles

## Talking

-   Mouth movement
-   Head nods
-   Eyebrow movement
-   Eye movement

------------------------------------------------------------------------

# Voice Interaction

The microphone remains active until the user presses **End
Conversation**.

Natural flow:

``` text
User
↓
Avatar
↓
User
↓
Avatar
```

No repeated microphone presses.

------------------------------------------------------------------------

# Interruptions (Barge-In)

If the avatar is speaking and the user starts talking:

1.  Stop avatar speech immediately.
2.  Return to listening.
3.  Process the new input.
4.  Continue the conversation.

------------------------------------------------------------------------

# UI Philosophy

The UI should almost disappear behind the avatar.

Avoid: - Chat windows - Sidebars - Dashboards - Cards

Use: - White background - Large whitespace - Floating controls - Minimal
typography

------------------------------------------------------------------------

# Idle Screen

``` text
┌──────────────────────────────┐
│          LUXORA              │
│                              │
│                              │
│                              │
│        👩 Digital Human       │
│                              │
│                              │
│                          🎤  │
│                          ⏹   │
│                              │
│      Welcome to Luxora       │
│                              │
│ How may I help you today?    │
└──────────────────────────────┘
```

No transcript. No products. No chat.

------------------------------------------------------------------------

# Avatar Animation Engine

Conversation Manager emits:

``` text
IDLE
LISTENING
THINKING
SPEAKING
STOP_SPEAKING
```

Avatar Engine handles all animation.

------------------------------------------------------------------------

# Milestones

1.  Project setup and architecture.
2.  Idle avatar.
3.  Idle animations.
4.  Browser speech recognition.
5.  Gemini streaming.
6.  Browser TTS.
7.  Barge-in.
8.  Polish.

------------------------------------------------------------------------

# Future Roadmap (Not Part of v1)

-   Product showcase
-   Website crawling
-   Company knowledge indexing
-   Avatar Builder Studio
-   Multiple avatars
-   Analytics
-   Admin dashboard

------------------------------------------------------------------------

# Success Criteria

A user should be able to talk to the avatar for two minutes and
genuinely feel like they are talking to a believable digital showroom
representative.
