# MindRest
MindRest is a Chrome extension that detects digital fatigue by tracking browsing behavior like scrolling and tab switching. It gently reminds users to take short breaks through smart, timed overlays. Built using JavaScript, TensorFlow.js Lite, and Chrome APIs, it runs locally to support focus without distractions.
MindRest — Chrome Extension

MindRest is a Chrome extension that detects digital fatigue through browsing behavior such as tab switching, scrolling, and idle time. When signs of overload appear, it gently reminds users to pause and refocus.

Features

AI-based fatigue detection using browsing patterns

Smart overlay reminders for short breaks

Do-Not-Disturb modes (1h, 4h, 8h, until tomorrow)

Fully on-device processing for privacy

Built With

JavaScript · HTML · CSS · TensorFlow.js Lite
Chrome Tabs · Storage · Runtime · Alarms APIs

Installation

Download and extract the folder.

Open chrome://extensions/ → Enable Developer Mode.

Click Load unpacked → Select the MindRest folder.

How It Works

MindRest computes a real-time fatigue score 
𝐹
F from tab switches, scroll velocity, and idle time.
If 
𝐹
>
𝐹
𝑐
𝑟
𝑖
𝑡
F>F
crit
	​

, a break overlay appears with gentle guidance.

Future Improvements

Smarter personalization

Integration with Chrome’s Digital Wellbeing tools

MindRest — your browser’s built-in pause button.
