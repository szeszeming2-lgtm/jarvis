// The honest feature list shown in About & Help: what works, where, and what each
// feature needs (internet, the Mac app, a one-time download, or extra hardware).
// "where": all | mac | web (browser/phone). "needs": short plain words, or ''.
export const FEATURES = [
  ['AI', [
    ['Chat with a local AI, history, search, many chats', 'all', ''],
    ['Memory, custom instructions, personalities', 'all', ''],
    ['AI modes: study, developer, research, creative, professional, teacher, translator, troubleshooting, planning', 'all', ''],
    ['Several AI models (Ollama on computers; built-in models on phones and tablets)', 'all', 'one-time model download'],
    ['Deep research with sources and a fact-checking reviewer', 'all', 'internet; whole web in the Mac app, Wikipedia in browsers'],
    ['Team of AI agents (planner → expert → critic → editor)', 'all', ''],
    ['Mission Control: up to 10 objectives, specialist agents, your approval before plans run and before anything is saved, live board, final reports', 'all', 'agents take turns on your device’s AI'],
  ]],
  ['Voice', [
    ['“JARVIS” / “Hey JARVIS” wake word, answers “Yes?”', 'mac', 'microphone'],
    ['Spoken replies, many voices, speed and pitch', 'all', ''],
    ['Offline speech recognition, push to talk, microphone sensitivity', 'mac', 'microphone'],
    ['Talk in the browser', 'web', 'microphone; some browsers send speech online'],
    ['Continuous conversation, interrupt by voice', 'mac', 'microphone'],
    ['Translate speech to English, ~100 languages', 'all', 'Whisper download (80 MB) in browsers'],
  ]],
  ['Computer control (asks first when set to)', [
    ['Open, switch to and quit apps; open websites and folders', 'mac', ''],
    ['Open phone apps (Spotify, Maps, WhatsApp…)', 'web', 'iPhone/Android'],
    ['Find files (Spotlight), make folders, rename and organize files with undo', 'mac', ''],
    ['Create and read documents (Word, PDF, Markdown)', 'all', ''],
    ['Screenshots, look at the screen, Circle to Ask', 'all', 'screen permission'],
    ['Volume, dark mode, Wi-Fi, sleep display, Shortcuts, approved Terminal commands', 'mac', ''],
    ['Clipboard: read, copy, history (memory only)', 'mac', ''],
  ]],
  ['Productivity', [
    ['Reminders (one-off and repeating), text me / call me', 'all', 'texts and calls come from the Mac app'],
    ['Make your iPhone ring for calls and texts (even when locked)', 'mac', 'iCloud Reminders on your iPhone'],
    ['Saved links (read later), page summaries', 'all', 'summaries need the Mac app'],
    ['Calendar in the morning briefing', 'mac', 'calendar permission'],
    ['Lists, notes, to-dos, shopping', 'all', ''],
    ['Projects with tasks, progress, notes, documents and chats', 'all', ''],
    ['Habits, goals, budget, stopwatch, timers, calculator, unit converter', 'all', ''],
    ['Voice notes and transcription', 'all', 'microphone'],
    ['Automations (“every weekday at 9am …”) with history', 'all', 'run while JARVIS is open'],
    ['Morning briefing, weather, take me home', 'all', 'internet for weather and maps'],
  ]],
  ['Documents', [
    ['Read PDF, Word, Excel, text and web pages; summarize and ask questions', 'all', ''],
    ['Compare documents, extract information, flashcards and quizzes', 'all', ''],
  ]],
  ['Vision and media', [
    ['Recognise and describe pictures, screenshots and camera photos', 'all', 'a vision model (Ollama) or the picture AI (210 MB)'],
    ['Edit pictures: crop, rotate, colour, filters, draw, text', 'all', ''],
    ['Make pictures from a description', 'mac', 'Ollama’s FLUX.2 Klein (5.7 GB), about 6 GB of memory'],
    ['Transcribe audio, summarize videos', 'all', 'speech-to-text (built into macOS; 80 MB download in browsers)'],
  ]],
  ['Plugins, sync and privacy', [
    ['Plugin store, make your own, share and paste community plugins', 'all', ''],
    ['Sign in with a secret phrase: live sync between your devices, deletions included', 'all', 'internet; JARVIS open on both (the Mac app stays open)'],
    ['Link devices (no account) and back up / restore everything', 'all', 'AirDrop or any way to send a file'],
    ['Floating orb, always-on-top window, global hotkeys', 'mac', ''],
    ['Permissions, activity log, export and delete your data, no tracking', 'all', ''],
    ['Light and dark themes, colours, text size, high contrast, lightweight mode', 'all', ''],
  ]],
];

export const NOT_YET = [
  'A real phone call to your own number: that needs a paid phone line. Instead the Mac app texts you a call link and makes your iPhone ring with an alert.',
  'Talking to JARVIS while your iPhone is locked or JARVIS is in the background: iPhones only let Siri listen then. The Mac app keeps listening for its wake word while it runs.',
  'Email, smart home, team workspaces and other online accounts: they need paid services or sign-ins that aren’t built.',
  'A full visual drag-and-drop workflow canvas: workflows are built as a list of steps (Plugins → Make a plugin → Actions).',
  'Translating the app’s own buttons into other languages: replies already come in your language.',
  'Native Windows, Linux, iPhone and Android apps: use the website there (it installs to the Home Screen).',
  'Making pictures on phones and in browsers: image models need about 6 GB of memory.',
];
