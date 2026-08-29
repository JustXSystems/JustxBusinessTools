# JustX upstreams — project {{PROJECT_ID}} (http context)
upstream justx_{{PROJECT_ID}}_web {
    server 127.0.0.1:{{WEB_PORT}};
    keepalive 32;
}

upstream justx_{{PROJECT_ID}}_api {
    server 127.0.0.1:{{API_PORT}};
    keepalive 32;
}
