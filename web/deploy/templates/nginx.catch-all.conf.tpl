# Catch-all — reject unknown Host headers
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;

    # Self-signed placeholder so nginx can bind 443 before real certs exist
    ssl_certificate     /etc/nginx/ssl/justx-catchall.crt;
    ssl_certificate_key /etc/nginx/ssl/justx-catchall.key;

    return 444;
}
