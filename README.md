# 🛡️ ConsentSync – Control Your Data

A powerful Chrome extension that gives you real-time control over your privacy and data across the web. ConsentSync provides comprehensive privacy monitoring, AI-powered policy analysis, and intelligent automation to protect your digital footprint.

## ✨ Features

### 🔍 **Real-time Privacy Monitoring**
- **Live Activity Feed**: See exactly when sites access your camera, microphone, location, or set cookies
- **Permission Tracking**: Monitor and control access to sensitive permissions in real-time
- **Cookie Management**: View, clear, and block cookies with granular control
- **Site-by-site Analysis**: Get detailed privacy insights for each website you visit

### 🧠 **AI-Powered Policy Analysis**
- **Smart Detection**: Automatically finds and fetches privacy policies
- **NLP Analysis**: Uses advanced text analysis to classify policy statements as:
  - ✅ **Safe** (green) - Privacy-friendly practices
  - ⚠️ **Ambiguous** (yellow) - Potentially concerning language
  - 🚨 **Manipulative** (red) - Red flags and risky practices
- **Risk Scoring**: Calculates comprehensive privacy scores (0-100) based on multiple factors
- **Summary Reports**: Get clear, actionable insights about each site's data practices

### 🎯 **Privacy Score Engine**
- **Multi-factor Scoring**: Considers policy analysis, permissions, cookies, and site behavior
- **Visual Indicators**: 
  - 🟢 **Safe** (80-100) - Low risk
  - 🟡 **Medium Risk** (50-79) - Exercise caution
  - 🔴 **High Risk** (0-49) - Significant privacy concerns
- **Breakdown Analysis**: See exactly what factors contribute to each site's score

### 🤖 **Smart Automation**
- **Learning System**: Remembers your privacy preferences and applies them automatically
- **Pattern Recognition**: Learns from your choices to suggest similar settings for new sites
- **Bulk Actions**: Clear all cookies, block tracking, or export settings with one click
- **Customizable Rules**: Fine-tune automation behavior to match your privacy needs

### 📊 **Comprehensive Dashboard**
- **Site Overview**: Track all visited sites with detailed privacy metrics
- **Statistics**: View total sites, average privacy scores, cookie counts, and risk levels
- **Filtering & Search**: Find specific sites or filter by risk level
- **Export Options**: Download your privacy data and settings for backup

## 🚀 Installation

### From Source
1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension folder
5. ConsentSync will appear in your extensions list

### Permissions Required
- **Cookies**: To monitor and manage cookie data
- **Storage**: To save your privacy preferences and settings
- **Tabs**: To analyze current website content
- **Scripting**: To inject privacy analysis tools
- **Content Settings**: To control permission access
- **Notifications**: To alert you about privacy events
- **Web Navigation**: To monitor site visits and changes

## 🎮 Usage Guide

### Popup Interface
1. **Click the ConsentSync icon** in your browser toolbar
2. **View Privacy Score**: See the current site's privacy rating at the top
3. **Monitor Activity**: Check the live feed for recent privacy events
4. **Control Permissions**: Allow/block camera, microphone, location, and notifications
5. **Manage Cookies**: Clear cookies or enable auto-cleanup
6. **Analyze Policies**: Fetch and analyze privacy policies with AI
7. **Export Data**: Download privacy reports and settings

### Dashboard
1. **Open Dashboard**: Click "Dashboard" in the popup or go to extension options
2. **View Statistics**: See overview of all tracked sites and privacy metrics
3. **Filter Sites**: Use search and filter options to find specific sites
4. **Bulk Actions**: Clear all cookies, export data, or manage settings
5. **Activity Log**: Review recent privacy events and actions

### Key Features

#### Privacy Score Calculation
The privacy score (0-100) is calculated based on:
- **Policy Analysis** (40%): AI analysis of privacy policy content
- **Permission Usage** (30%): Number and type of permissions requested
- **Cookie Behavior** (20%): Number of cookies and tracking behavior
- **Site Security** (10%): HTTPS usage and security indicators

#### AI Policy Analysis
The extension analyzes privacy policies by:
1. **Fetching** the policy text from detected links
2. **Cleaning** HTML and formatting for analysis
3. **Classifying** sentences using keyword analysis
4. **Scoring** based on privacy-friendly vs. concerning language
5. **Summarizing** key findings and recommendations

#### Automation Learning
The system learns from your choices:
- **Permission Decisions**: Remembers your allow/block preferences
- **Pattern Recognition**: Identifies similar sites and suggests settings
- **Adaptive Behavior**: Adjusts recommendations based on your usage patterns
- **Manual Override**: Always allows manual control over automated decisions

## 🔧 Configuration

### Auto-Clean Settings
- **Enable/Disable**: Toggle automatic cookie cleanup
- **Timing**: Set cleanup intervals (1 hour to 1 month)
- **Selective**: Choose which types of cookies to auto-clean

### Automation Rules
- **View Rules**: See current learning patterns
- **Reset Learning**: Clear all learned preferences
- **Manual Control**: Override automated decisions when needed

### Export Options
- **Privacy Reports**: Download detailed site analysis
- **Settings Backup**: Export all preferences and rules
- **Data Portability**: Transfer settings between browsers

## 🛠️ Technical Details

### Architecture
- **Manifest V3**: Modern Chrome extension architecture
- **Service Worker**: Background processing and monitoring
- **Content Scripts**: Real-time page analysis
- **Storage API**: Persistent data management
- **Chrome APIs**: Native browser integration

### Privacy Analysis Algorithm
```javascript
// Simplified scoring algorithm
function calculatePrivacyScore(policyText, permissions, cookieCount) {
  let score = 100;
  
  // Policy risk (0-40 points)
  const policyHits = analyzePolicyText(policyText);
  score -= Math.min(policyHits * 3, 40);
  
  // Permission risk (0-30 points)
  const permissionScores = {geolocation: 8, camera: 10, microphone: 10, notifications: 5};
  permissions.forEach(perm => score -= permissionScores[perm] || 0);
  
  // Cookie risk (0-20 points)
  score -= Math.min(cookieCount * 2, 20);
  
  return Math.max(0, Math.round(score));
}
```

### Data Storage
- **Local Storage**: Site-specific data and preferences
- **Sync Storage**: Cross-device settings and automation rules
- **Memory**: Real-time monitoring data (cleared on restart)

## 🔒 Privacy & Security

### Data Collection
- **No Personal Data**: Extension doesn't collect or transmit personal information
- **Local Processing**: All analysis happens locally in your browser
- **No Tracking**: Extension itself doesn't track your browsing
- **Transparent**: All data storage and processing is visible in the code

### Security Features
- **CSP Compliance**: Content Security Policy for safe execution
- **Permission Minimization**: Only requests necessary browser permissions
- **Secure Storage**: Uses Chrome's secure storage APIs
- **No External Calls**: All functionality is self-contained

## 🐛 Troubleshooting

### Common Issues

**Extension not loading**
- Check if Developer mode is enabled
- Verify all files are present in the extension folder
- Check Chrome's extension error console

**Permissions not working**
- Ensure all required permissions are granted
- Check if the site is using HTTPS (required for some permissions)
- Verify the extension is enabled for the site

**Policy analysis failing**
- Check if the site has a privacy policy link
- Verify internet connection for policy fetching
- Try refreshing the page and re-analyzing

**Dashboard not loading**
- Check if the extension has storage permissions
- Clear browser cache and reload
- Verify the dashboard.html file is present

### Debug Mode
Enable debug logging by:
1. Opening Chrome DevTools
2. Going to the Console tab
3. Looking for "ConsentSync" log messages

## 🤝 Contributing

### Development Setup
1. Fork the repository
2. Make your changes
3. Test thoroughly in Chrome
4. Submit a pull request

### Code Structure
```
ConsentSync_Ext_v0.6.1/
├── manifest.json          # Extension configuration
├── popup.html            # Main popup interface
├── popup.js              # Popup functionality
├── dashboard.html        # Full dashboard page
├── dashboard.js          # Dashboard functionality
├── service_worker.js     # Background processing
├── content.js            # Page content analysis
├── style.css             # Styling and animations
└── icons/                # Extension icons
```

### Testing
- Test on various websites with different privacy policies
- Verify permission controls work correctly
- Check that automation learning functions properly
- Ensure data export/import works as expected

## 📄 License

This project is open source and available under the MIT License. See the LICENSE file for details.

## 🙏 Acknowledgments

- **Chrome Extensions API**: For providing the platform
- **Font Awesome**: For the beautiful icons
- **Privacy Community**: For inspiration and feedback

## 📞 Support

For issues, questions, or feature requests:
1. Check the troubleshooting section above
2. Review the code comments for technical details
3. Open an issue on the project repository

---

**ConsentSync v0.6.1** - Take control of your digital privacy today! 🛡️
