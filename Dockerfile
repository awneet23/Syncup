# Meet-Actions Chrome Extension - Docker Configuration
# For demonstration and development purposes

FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Create a simple web server for extension development
RUN npm init -y && npm install express cors

# Copy extension files
COPY . .

# Create a simple server to serve the extension files
RUN cat > server.js << 'EOF'
const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors());

// Serve static files (extension files)
app.use(express.static('.'));

// API endpoint to provide extension information
app.get('/api/extension-info', (req, res) => {
  res.json({
    name: 'Meet-Actions',
    version: '1.0.0',
    description: 'AI-powered action item extraction for Google Meet',
    technologies: ['Chrome Extensions', 'Cerebras API', 'Meta Llama', 'AssemblyAI'],
    hackathon: 'FutureStack GenAI Hackathon',
    features: [
      'Real-time transcription',
      'AI-powered action item extraction',
      'Live sidebar integration',
      'Session management',
      'Smart priority detection'
    ]
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Extension download endpoint
app.get('/download', (req, res) => {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="meet-actions-extension.zip"');
  res.send('Extension files would be zipped here for download');
});

// Installation instructions
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Meet-Actions Extension Server</title>
      <style>
        body { 
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
          max-width: 800px; 
          margin: 0 auto; 
          padding: 20px; 
          background: #f5f5f5; 
        }
        .header { 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
          color: white; 
          padding: 40px; 
          border-radius: 10px; 
          text-align: center; 
          margin-bottom: 30px; 
        }
        .card { 
          background: white; 
          padding: 30px; 
          border-radius: 10px; 
          box-shadow: 0 2px 10px rgba(0,0,0,0.1); 
          margin-bottom: 20px; 
        }
        .code { 
          background: #2d3748; 
          color: #e2e8f0; 
          padding: 15px; 
          border-radius: 5px; 
          font-family: 'Courier New', monospace; 
          margin: 10px 0; 
        }
        .button { 
          background: #4299e1; 
          color: white; 
          padding: 12px 24px; 
          border: none; 
          border-radius: 5px; 
          text-decoration: none; 
          display: inline-block; 
          margin: 5px; 
        }
        .tech-stack { 
          display: flex; 
          flex-wrap: wrap; 
          gap: 10px; 
          margin: 15px 0; 
        }
        .tech-tag { 
          background: #e2e8f0; 
          padding: 5px 12px; 
          border-radius: 20px; 
          font-size: 14px; 
        }
        .demo-note {
          background: #fef5e7;
          border-left: 4px solid #f6ad55;
          padding: 15px;
          margin: 20px 0;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>📋 Meet-Actions</h1>
        <p>AI-Powered Action Item Extraction for Google Meet</p>
        <p><strong>FutureStack GenAI Hackathon Project</strong></p>
      </div>

      <div class="card">
        <h2>🚀 Quick Installation</h2>
        <ol>
          <li><strong>Download Extension Files:</strong> All files are served from this container</li>
          <li><strong>Open Chrome:</strong> Navigate to <code>chrome://extensions/</code></li>
          <li><strong>Enable Developer Mode:</strong> Toggle the switch in the top-right</li>
          <li><strong>Load Extension:</strong> Click "Load unpacked" and select the extension folder</li>
          <li><strong>Configure APIs:</strong> Add your Cerebras and AssemblyAI keys to background.js</li>
        </ol>
        
        <div class="demo-note">
          <strong>💡 Demo Mode Available:</strong> The extension works without API keys using mock data - perfect for hackathon demonstrations!
        </div>
      </div>

      <div class="card">
        <h2>🛠️ Technology Stack</h2>
        <div class="tech-stack">
          <span class="tech-tag">Chrome Extensions API</span>
          <span class="tech-tag">Cerebras AI</span>
          <span class="tech-tag">Meta Llama</span>
          <span class="tech-tag">AssemblyAI</span>
          <span class="tech-tag">Docker</span>
          <span class="tech-tag">Web Audio API</span>
          <span class="tech-tag">Vanilla JavaScript</span>
        </div>
      </div>

      <div class="card">
        <h2>📁 Available Files</h2>
        <ul>
          <li><a href="/manifest.json" class="button">manifest.json</a></li>
          <li><a href="/background.js" class="button">background.js</a></li>
          <li><a href="/content_script.js" class="button">content_script.js</a></li>
          <li><a href="/popup.html" class="button">popup.html</a></li>
          <li><a href="/popup.js" class="button">popup.js</a></li>
          <li><a href="/styles.css" class="button">styles.css</a></li>
          <li><a href="/README.md" class="button">README.md</a></li>
        </ul>
      </div>

      <div class="card">
        <h2>🎯 Key Features</h2>
        <ul>
          <li><strong>Real-time Transcription:</strong> Live audio capture from Google Meet</li>
          <li><strong>AI Analysis:</strong> Cerebras + Llama for lightning-fast action item extraction</li>
          <li><strong>Smart Sidebar:</strong> Non-intrusive UI integration with Google Meet</li>
          <li><strong>Session Management:</strong> Start/stop controls with live statistics</li>
          <li><strong>Priority Detection:</strong> Automatic priority and assignee identification</li>
        </ul>
      </div>

      <div class="card">
        <h2>🐳 Docker Commands</h2>
        <div class="code">
# Build the container<br>
docker build -t meet-actions .<br><br>
# Run the server<br>
docker run -p 3000:3000 meet-actions<br><br>
# Development mode with volume mounting<br>
docker run -v $(pwd):/app -p 3000:3000 meet-actions
        </div>
      </div>

      <div class="card">
        <h2>🔗 API Endpoints</h2>
        <ul>
          <li><a href="/api/extension-info" class="button">Extension Info API</a></li>
          <li><a href="/health" class="button">Health Check</a></li>
        </ul>
      </div>

      <footer style="text-align: center; margin-top: 40px; color: #666;">
        <p>Built with ❤️ for FutureStack GenAI Hackathon</p>
        <p>Powered by Cerebras AI + Meta Llama</p>
      </footer>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`Meet-Actions Extension Server running on port ${PORT}`);
  console.log(`Access the extension files at: http://localhost:${PORT}`);
  console.log(`Extension info API: http://localhost:${PORT}/api/extension-info`);
});
EOF

# Production stage
FROM node:18-alpine AS production

WORKDIR /app

# Copy built application
COPY --from=builder /app .

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start the server
CMD ["node", "server.js"]