"""Harmless browser-boundary probe; it does not read real credentials."""
import asyncio
import js


async def main():
    for name in ("document", "localStorage", "parent"):
        print(name, hasattr(js, name))
    print("worker_origin", js.self.origin)
    urls = [
        ("local_site", "http://127.0.0.1:8768/"),
        ("other_site", "https://example.com/"),
        ("runtime_cdn", "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs"),
    ]
    for label, url in urls:
        try:
            response = await js.fetch(url)
            print(label, "allowed", response.status)
        except Exception as error:
            print(label, "blocked", type(error).__name__)


asyncio.run(main())
