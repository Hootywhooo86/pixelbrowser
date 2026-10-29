# Store listing copy

Ready to paste into Google Play Console and App Store Connect. Replace the
bracketed parts.

## App name

**Bit Browser: Private AI Browser** (30 characters, which fits both stores)

## Short description (Google Play, ≤80 characters)

Private pixel browser with built-in ad blocking and an AI that works for you.

(77 characters)

## App Store subtitle (≤30 characters)

Private browser + AI helper

## Full description

Bit Browser is a fast, private web browser with a chunky pixel-art look and an AI assistant you control.

**BLOCK ADS AND TRACKERS**
Bit Shields blocks ads, trackers and annoying pop-ups on every site, using the same trusted filter lists as the most popular ad blockers. Pages load faster and use less battery. Turn Shields down for any site with one tap.

**AN AI THAT WORKS FOR YOU, NOT ON YOU**
Bitter, the built-in assistant, can summarize a page or a video, explain what you highlight, compare your tabs and answer questions with links to its sources. Use the AI you already like (Claude, ChatGPT, Gemini and more) with your own key, or a model running on your own computer. One switch turns all AI off.

**PRIVATE BY DESIGN**
• No account, no analytics, no tracking
• Private tabs that forget everything, with optional fingerprint lock
• Warnings for phishing and malware sites, checked on your device
• Panic button: close private tabs and wipe recent history in one tap

**EVERYTHING IN SYNC, END-TO-END ENCRYPTED**
Sync tabs, bookmarks, history and settings between your phone and computer. Everything is encrypted on your device first: the sync server can't read it.

**BUILT FOR GETTING THINGS DONE**
• Bit Password Manager with autofill
• Downloads that work, with a PDF viewer that prints shipping labels
• Pinned tabs and Spaces for Work, Personal and more
• Bookmarks, history, find in page, reader mode and translate

**PIXEL STYLE**
Pick a pixel theme (Game Boy, Arcade, Sunset and more) or build your own. Earn XP, streaks and badges for good browsing habits.

Part of the 128bit family of apps.

## Feature bullets (for the website or press)

- Built-in ad, tracker and cookie-banner blocking (Bit Shields)
- AI assistant with your choice of provider; one switch turns all AI off
- End-to-end encrypted sync between phone and computer
- Password manager with biometric unlock
- Pinned tabs, Spaces, bookmarks, history, reader mode
- PDF viewer with printing, for labels and invoices
- Pixel themes, XP, streaks and weekly quests

## Category and keywords

- **Google Play category:** Communication (where Chrome, Brave and Firefox are listed). Tags: Browser, Privacy.
- **App Store category:** Utilities (primary), Productivity (secondary).
- **App Store keywords (≤100 characters):** `browser,private,adblock,ad blocker,AI,assistant,privacy,pixel,web,sync,tracker,incognito`

## Content rating notes

- A web browser can show any website, so both stores rate browsers for **unrestricted web access**:
  - Google Play IARC questionnaire: answer **Yes** to "Does the app allow users to access unrestricted internet content?" (Expect Teen or Mature 17+.)
  - App Store age rating: **"Unrestricted Web Access" = Yes**, which makes it 17+.
- No user-generated content in the app itself, no gambling, no ads.

## Google Play: data safety form

| Question | Answer |
|---|---|
| Does the app collect or share any of the required user data types? | **No.** Nothing is sent to the developer. |
| Is all user data encrypted in transit? | **Yes** (HTTPS; sync is also end-to-end encrypted). |
| Can users request that data be deleted? | **Yes**: all data is on the device, and Settings → Your data deletes it; leaving sync deletes the server copy. |
| Data the app accesses but doesn't collect | Web browsing history, passwords and payment info: stored on the device only (and in encrypted sync if the user turns it on, which the developer can't read). |

Notes for the form:

- AI requests go from the device straight to the provider the user picks, with the user's own key. The developer doesn't receive them.
- End-to-end encrypted data the developer can't read doesn't count as "collected" under Google's definitions.

## App Store: App Privacy ("nutrition label")

**Data Not Collected.** Same reasoning as above.

## Privacy policy URL

Publish `docs/PRIVACY.md` (for example via GitHub Pages, or the landing page) and use that URL in both stores.

## Screenshot shot list

Phone (1080×1920 or larger), in this order:

1. A news site with the shield showing "42 blocked". Caption: "Blocks ads and trackers".
2. The Bitter panel summarizing an article, with source chips. Caption: "Ask Bitter about any page".
3. The tabs grid with pinned tabs and the Spaces chips (Work / Personal). Caption: "Pinned tabs and Spaces".
4. The PDF viewer showing a shipping label with PRINT. Caption: "Downloads and labels that just work".
5. Settings → Appearance with the Game Boy theme. Caption: "Make it yours with pixel themes".
6. The 128bit family page: level, XP bar, badges, weekly quests. Caption: "Earn XP for good habits".
7. A private tab with the lock screen. Caption: "Private tabs, locked with your fingerprint".
8. Settings → Sync with the QR code. Caption: "End-to-end encrypted sync".

Tablet: the same shots on a 10" tablet showing the top tab strip and the Bitter side panel.

Google Play also needs a **feature graphic** (1024×500): the pixel "B" logo on navy with "Bit Browser" in the pixel font.

## Google Play policy: YouTube ad blocking

Google Play doesn't allow apps that interfere with or block ads in **YouTube** (Policy: "Interference with apps and third-party ads", and YouTube's Terms of Service). Blocking ads on websites in general is fine, which is why Brave, Firefox and DuckDuckGo are on Play. But a build that skips YouTube ads is likely to be rejected or removed.

**Suggested fix:** a build flag for the Play Store build that turns off the YouTube scriptlets and the YouTube ad-skipping layer, while keeping normal ad and tracker blocking:

- Add an environment variable to the Android build, for example `BIT_PLAY_BUILD=1`, exposed to the app through `app.json` → `extra.playBuild`, read with `expo-constants`.
- In `apps/mobile/src/shields.js`, when `playBuild` is set, drop the scriptlets and cosmetic rules for `youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtube-nocookie.com` and `youtubekids.com`, and skip the built-in YouTube backup layer.
- Keep publishing the GitHub APK without the flag, so sideloaded users keep full YouTube blocking.

App Store review has similar rules about YouTube, so use the same flag for the iPhone build.
