# HTTP-only bootstrap (before Let's Encrypt). Canonical host: {{DOMAIN}}
limit_req_zone $binary_remote_addr zone=justx_global_limit:20m rate=20r/s;

server {
    listen 80;
    listen [::]:80;
    server_name {{DOMAIN_ALT}};
    return 301 http://{{DOMAIN}}$request_uri;
}

server {
    listen 80;
    listen [::]:80;
    server_name {{DOMAIN}};

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
        allow all;
    }

    access_log /var/log/deployments/nginx-{{DOMAIN_SLUG}}-access.log;
    error_log  /var/log/deployments/nginx-{{DOMAIN_SLUG}}-error.log warn;
    client_max_body_size 25m;

    include /etc/nginx/justx.d/{{DOMAIN_SLUG}}/*.conf;

    location = / {
        root /var/www/html;
        try_files /index.html =404;
    }
}
