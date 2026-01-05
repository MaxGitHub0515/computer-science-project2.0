# 123

<!-- MONOREPO  - NOT CONSIDERED TO BE HIGHLY SCALABLE BUT ENOUGH FOR OUR PROJECT-->

Logging - winston, morgan(logging via http request)


Gameplay changes: 
- **No submission or voting timeouts** — submission phase waits until everyone submits; voting waits similarly. This can stall games if someone abandons.
- **Reconnection/resume handling** — disconnect marks player as disconnected but there's no explicit reconnect flow to re-associate the same playerId and restore state.
- **Tie handling & scoring** — ties result in "no one eliminated"; no scoring/leaderboard or incentive mechanics.
- **Image round support is only typed** — server supports roundType but client doesn't offer uploads or display for image rounds.


UI Changes:
- RoundPage:
    - Progress bar for submissions and votes (aria attributes + visible percentage).
    - Count announcements and toasts when submissions/votes increase ("N submitted • M remaining").
    - Accessible sr-only live region (`aria-live="polite"`) for assistive tech.
    - Submit button made full-width and given aria-label; voting buttons made full-width, given aria-label, and larger tap targets.
- GameOverPage:
    - Added round history / replay: per round show target, submissions (text or image), votes tally, and eliminated players.
    - Accessibility: lists have role="list", images have alt text, restart button gets aria-label.
- General:
    - Tracked previous submission/vote counts in RoundPage to generate notifications.
    - Kept changes conservative to avoid exposing who submitted which content (notifications show counts, not identities).