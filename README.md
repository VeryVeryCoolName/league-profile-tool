# League Profile Tool - League of Legends Profile Customization Tool

A modernized and actively maintained **League of Legends profile customization tool** built around Riot's local **League Client Update API**.

League Profile Tool lets you customize League profile icons, profile backgrounds, chat rank, challenge rank, status/presence, lobby links, and other League Client profile visuals through the local League Client API.

**Official website:** https://leagueprofiletool.servertheo.top/

Originally based on the project by [MManoah](https://github.com/MManoah/league-profile-tool), this fork focuses on restoring broken functionality, improving compatibility with the modern League Client, polishing the UI, and adding new customization features while preserving the original spirit of the application.

## Features

- Custom profile icons
- Custom profile backgrounds
- Chat and challenge rank customization
- Custom status/presence editing
- Live profile preview
- Match tools, including auto accept, lane prediction, and matchup links
- Friends list tools
- Lobby invite link creation
- Direct LCU API requests through Custom API
- Modern League Client compatibility
- Lightweight Electron desktop application

## Download

Choose the version that fits your setup:

# [Download the Installer](https://github.com/VeryVeryCoolName/league-profile-tool/releases/download/V3.4.2/League.Profile.Tool.Setup.3.4.2.exe)
# [Download the 64-bit Portable ZIP](https://github.com/VeryVeryCoolName/league-profile-tool/releases/download/V3.4.2/LeagueProfileTool.zip)
# [Download the 32-bit Portable ZIP](https://github.com/VeryVeryCoolName/league-profile-tool/releases/download/V3.4.2/LeagueProfileTool.32-bit.zip)

Setup:

1. Make sure the League Client is already running.
2. If you downloaded the installer, launch `League.Profile.Tool.Setup.3.4.2.exe` and follow the prompts.
3. If you downloaded a portable ZIP, extract it somewhere on your computer and launch `League Profile Tool.exe`.

Older versions and changelogs are available in the [Releases](https://github.com/VeryVeryCoolName/league-profile-tool/releases) section.

## Preview

[![League Profile Tool screenshot](https://i.postimg.cc/brsrZCqC/Screenshot.png)](https://postimg.cc/4HRsM17V)

## How It Works

League Profile Tool connects to the local League Client through Riot's LCU API while the client is running. This allows the app to interact with client-side profile and presence features without modifying League of Legends game files.

Most features require the League Client to be open before launching or using the tool.

## Built With

- [Electron](https://github.com/electron/electron)
- [Angular](https://github.com/angular/angular)
- [Angular Material](https://material.angular.io/)
- [lcu-connector](https://github.com/Pupix/lcu-connector)
- TypeScript

## Safety Notes

- This tool uses Riot's local LCU API exposed by the League Client.
- No League of Legends game files are modified.
- Some cosmetic changes are temporary and may reset after League Client refreshes, queue, champion select, or game start.
- The League Client must be running for most features to work.
- Use the tool responsibly and avoid sending unsafe or unsupported custom API requests.

## Credits

This project was originally based on [MManoah/league-profile-tool](https://github.com/MManoah/league-profile-tool).

This fork focuses on maintenance, compatibility fixes, UI improvements, and additional League Client customization features.

## Riot Games Disclaimer

This project is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing League of Legends.

League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc.

League of Legends © Riot Games, Inc.
