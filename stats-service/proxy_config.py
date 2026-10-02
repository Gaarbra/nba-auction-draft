"""Configure Requests before importing NBA clients; never log proxy credentials."""
import os
from urllib.parse import urlsplit


def configure_proxy():
    proxy_url = os.environ.get("PROXY_URL", "").strip()
    if not proxy_url:
        return False
    try:
        parsed = urlsplit(proxy_url)
        valid = parsed.scheme in ("http", "https") and parsed.hostname and parsed.port
        valid = valid and not parsed.query and not parsed.fragment and parsed.path in ("", "/")
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("PROXY_URL must be an HTTP(S) proxy URL with a host and port")

    for name in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        os.environ[name] = proxy_url
    internal = "localhost,127.0.0.1,::1,web,server,stats,db,169.254.169.254"
    exclusions = ",".join(filter(None, (internal, os.environ.get("NO_PROXY"), os.environ.get("no_proxy"))))
    os.environ["NO_PROXY"] = os.environ["no_proxy"] = exclusions
    return True
