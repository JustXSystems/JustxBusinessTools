/var/log/deployments/*.log
/var/log/deployments/*/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    copytruncate
    create 0640 deploy deploy
}
