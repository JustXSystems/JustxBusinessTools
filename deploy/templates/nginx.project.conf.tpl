# JustX project {{PROJECT_ID}} locations — included inside server { }
# Public: https://{{DOMAIN}}{{BASE_PATH}}

location {{BASE_PATH}}/api/ {
    limit_req zone=justx_global_limit burst=30 nodelay;
    proxy_pass http://justx_{{PROJECT_ID}}_api/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_read_timeout 120s;
    proxy_buffering off;
}

location {{BASE_PATH}}/_next/static/ {
    proxy_pass http://justx_{{PROJECT_ID}}_web;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    add_header Cache-Control "public, max-age=31536000, immutable";
}

location {{BASE_PATH}} {
    limit_req zone=justx_global_limit burst=40 nodelay;
    proxy_pass http://justx_{{PROJECT_ID}}_web;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 120s;
}
