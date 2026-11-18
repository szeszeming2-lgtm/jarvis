# JARVIS — free local AI assistant (web version)

**Open it:** https://szeszeming2-lgtm.github.io/jarvis/

JARVIS is a free, private AI assistant. The AI runs on your own computer with [Ollama](https://ollama.com), so there are no accounts, no subscriptions, no API keys and no ads. Conversations, memories and settings stay in your browser on your computer.

## On your phone (iPhone or Android)

1. Open the link above in Safari (iPhone) or Chrome (Android).
2. Tap Share → **Add to Home Screen**. It opens full-screen like an app and keeps your data safe.
3. In setup, choose **On this device** and download a free AI model once (about 0.3–1 GB, Wi-Fi recommended). After that it works offline, with no account and nothing sent anywhere.
   This needs iOS 26 or newer, or a recent Android phone with Chrome.

**Workout Coach:** prop your phone up and say “track my squats”. The camera counts 14 moves (squats, push-ups, jumping jacks, curls, lunges, sit-ups and crunches, shoulder press, lateral raises, high knees, glute bridges, burpees, pull-ups, plus plank and wall-sit timers) using Google’s free MediaPipe body tracking, entirely on your phone, and keeps a workout log and streak.

**Circle to Ask:** tap the camera button, take a photo or pick one, draw a circle around anything and ask about it (“what is this?”, “read the text”, “translate this”). On phones a small free picture AI (SmolVLM, about 210 MB, downloaded once after you agree) answers on the phone itself.

**Plugins:** Settings → Plugins has a free plugin store (website shortcuts like YouTube or Wikipedia search, helpers, action combos). Make your own, or paste a plugin a friend shares; you always see what a plugin can do before adding it.

**Link devices:** Settings → Link devices makes your phone and computer match (lists, people, reminders, plugins, memory, workouts, recent chats, settings). No account: one device makes a locked file, you AirDrop it, and type the code on the other.

**Every morning:** say “good morning” (or let it pop up after 7:30) for the weather and what you need to do today. **“Take me home”** opens directions home in Maps.

Even without the AI download, the phone version does reminders (with **Add to iPhone Calendar**), shopping and to-do lists, notes, texts and calls to saved people, opening your apps (“open Spotify”), a system report, a unit converter, timers, weather, and maths.

## On a computer

1. Install [Ollama](https://ollama.com/download) (free) and open it.
2. Open the link above. The setup wizard shows one command to copy and paste so Ollama lets this website talk to it. You only do this once.
3. Pick or download a free model in the wizard. A small model (1–4B) runs well on most computers.

Speed depends on your computer. Smaller models answer faster; bigger ones are smarter.

## What works in the web version

Chat with streaming replies, conversation history, memory you control, custom instructions, skills, instant commands (maths, timers, time), web searches, spoken replies, themes and keyboard shortcuts. It also works offline once loaded.

- **Reminders:** "remind me at 5pm to call the bank". JARVIS speaks and shows the reminder when it's due (while open). **Add to Calendar** saves it to your phone or computer calendar so you're reminded even when JARVIS is closed.
- **Texts and calls:** "text +1 555 0100 saying I'm on my way" or "call +44 20 7946 0000". Your messages or phone app opens with everything filled in; you press Send or Call.
- **Texts and calls in other apps:** "call Sam on Discord", "WhatsApp Mom saying I'm on my way", "video call Jo". Save someone's Discord, WhatsApp, Telegram and more under Lists & People.
- **Circle to Ask:** click the circle button, take a photo, pick a picture or share your screen, draw a circle around anything and ask about it. With a free Ollama vision model (for example `gemma3:4b`) answers are best; otherwise the small built-in picture AI answers.

Opening apps, files, system settings, sending texts automatically, looking up contacts, clicking anywhere on screen to identify it, offline voice input and the wake word need the JARVIS desktop app (in progress).

## Privacy

- No tracking, analytics, cookies or ads.
- GitHub only serves the page files. Everything you type goes to Ollama on your own computer.
- Your data is stored in this browser. Settings → Privacy & Data lets you export or delete it.

MIT licence. AI models come from the Ollama library under their own licences.
