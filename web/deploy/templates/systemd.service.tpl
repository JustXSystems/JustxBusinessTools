[Unit]
Description=JustX {{PROJECT_ID}} {{ROLE}}
After=network.target mysql.service

[Service]
Type=simple
User={{USER}}
WorkingDirectory={{RELEASE_DIR}}
EnvironmentFile={{ENV_FILE}}
Environment=NODE_ENV=production
Environment=PORT={{PORT}}
Environment=NEXT_PUBLIC_BASE_PATH={{BASE_PATH}}
Environment=WEB_BASE_PATH={{BASE_PATH}}
ExecStart=/usr/bin/bash -lc '{{CMD}}'
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
