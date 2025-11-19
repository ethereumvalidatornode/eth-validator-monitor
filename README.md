# ETH Validator Monitor

A beautiful, standalone desktop application for monitoring your Ethereum validators in real-time.

![ETH Validator Monitor](https://img.shields.io/badge/Ethereum-Validator%20Monitor-627EEA?style=for-the-badge&logo=ethereum)

## Features

✨ **Real-time Monitoring**
- Monitor multiple validators from a single dashboard
- Live balance, effectiveness, and uptime tracking
- Block proposal and attestation history

📊 **Performance Analytics**
- Health score calculation for each validator
- Income tracking (attestations, proposals, sync committee)
- Miss rate analysis and alerts

🎨 **Beautiful UI**
- Modern, dark-themed interface
- Responsive design with smooth animations
- System tray integration

🔒 **Privacy First**
- All data stored locally on your machine
- No telemetry or tracking
- Standalone application - works offline

## Screenshots

<!-- Add screenshots here -->

## Installation

### Download Pre-built Binary

1. Go to [Releases](https://github.com/ethereumvalidatornode/eth-validator-monitor/releases)
2. Download the latest version for your platform:
   - Windows: `ETH-Validator-Monitor-Setup-X.X.X.exe`
   - macOS: `ETH-Validator-Monitor-X.X.X.dmg`
   - Linux: `ETH-Validator-Monitor-X.X.X.AppImage`
3. Install and run

### Build from Source

#### Prerequisites

- Node.js 18+ and npm
- Git

#### Steps

```bash
# Clone the repository
git clone https://github.com/ethereumvalidatornode/eth-validator-monitor.git
cd eth-validator-monitor

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build          # Windows
npm run build:mac      # macOS
npm run build:all      # All platforms
```

## Configuration

### Beaconcha.in API Key (Optional)

The app uses the [Beaconcha.in](https://beaconcha.in) API to fetch validator data. You can use it without an API key (free tier with rate limits), or add your own key for higher limits:

1. Get a free API key at [https://beaconcha.in/user/settings#api](https://beaconcha.in/user/settings#api)
2. Create a `.env` file in the project root:
   ```
   BEACONCHAIN_API_KEY=your_api_key_here
   ```
3. Restart the app

## Usage

1. **Launch the app** - Open ETH Validator Monitor
2. **Add a validator** - Click "Add Validator" and enter your validator index or public key
3. **Monitor** - View real-time stats, health scores, and performance metrics
4. **Settings** - Configure refresh intervals and notification preferences

## Project Structure

```
eth-validator-monitor/
├── src/
│   ├── electron/          # Electron main process
│   │   ├── main.js       # Main process logic
│   │   └── preload.js    # Preload script (context bridge)
│   └── ui/               # Renderer process (UI)
│       ├── index.html    # Main HTML
│       ├── app.js        # Application logic
│       └── styles.css    # Styling
├── assets/               # Icons and images
├── build/                # Build configuration
├── package.json          # Dependencies and scripts
└── electron-builder.yml  # Electron Builder config
```

## Development

### Tech Stack

- **Electron** - Desktop framework
- **Vanilla JavaScript** - No framework overhead
- **Beaconcha.in API** - Validator data source
- **Electron Builder** - Packaging and distribution

### Scripts

```bash
npm start              # Run the app (production mode)
npm run dev            # Run with development tools
npm run build          # Build for Windows
npm run build:mac      # Build for macOS
npm run build:all      # Build for all platforms
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Beaconcha.in](https://beaconcha.in) for the excellent Ethereum beacon chain explorer and API
- The Ethereum community for building amazing tools

## Support

If you find this tool useful, consider:
- ⭐ Starring the repository
- 🐛 Reporting bugs or requesting features via [Issues](https://github.com/ethereumvalidatornode/eth-validator-monitor/issues)
- 💬 Joining the discussion in [Discussions](https://github.com/ethereumvalidatornode/eth-validator-monitor/discussions)

## Disclaimer

This tool is provided as-is without any warranties. Always verify important information using official Ethereum tools.

---

Made with ❤️ for the Ethereum validator community

