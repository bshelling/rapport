import html
import re

import nh3

# Matches what the Tiptap editor in the web app can produce.
ALLOWED_TAGS = {"p", "br", "strong", "em", "ul", "ol", "li"}


def sanitize(value: str) -> str:
    return nh3.clean(value, tags=ALLOWED_TAGS, attributes={}).strip()


def plain_text(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()
