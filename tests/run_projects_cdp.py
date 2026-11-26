"""Read the result of tests/projects_browser.html from a running Chrome CDP page."""

import base64
import json
import os
import socket
import struct
import time
import urllib.parse
import urllib.request


DEBUG_URL = os.environ.get("CHROME_DEBUG_URL", "http://127.0.0.1:9224")
PAGE_URL = os.environ.get("PROJECTS_TEST_URL", "http://127.0.0.1:8768/tests/projects_browser.html")


def read_exact(sock, size):
    chunks = bytearray()
    while len(chunks) < size:
        chunk = sock.recv(size - len(chunks))
        if not chunk:
            raise ConnectionError("Chrome closed the DevTools WebSocket")
        chunks.extend(chunk)
    return bytes(chunks)


class Cdp:
    def __init__(self, url):
        address = urllib.request.urlopen(DEBUG_URL + "/json/list", timeout=5)
        pages = json.load(address)
        page = next(item for item in pages if item.get("type") == "page" and item.get("url") == url)
        ws_url = page["webSocketDebuggerUrl"]
        parsed = urllib.parse.urlparse(ws_url)
        self.sock = socket.create_connection((parsed.hostname, parsed.port), timeout=5)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        request = (
            f"GET {parsed.path} HTTP/1.1\r\nHost: {parsed.hostname}:{parsed.port}\r\n"
            f"Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\nOrigin: http://localhost\r\n\r\n"
        )
        self.sock.sendall(request.encode("ascii"))
        headers = bytearray()
        while not headers.endswith(b"\r\n\r\n"):
            headers.extend(self.sock.recv(1))
        if b" 101 " not in headers:
            raise ConnectionError(headers.decode("latin1"))
        self.sock.settimeout(2)
        self.next_id = 1
        self.events = []

    def send(self, payload):
        data = json.dumps(payload).encode("utf-8")
        mask = os.urandom(4)
        size = len(data)
        if size < 126:
            header = bytes((0x81, 0x80 | size))
        elif size < 65536:
            header = bytes((0x81, 0x80 | 126)) + struct.pack("!H", size)
        else:
            header = bytes((0x81, 0x80 | 127)) + struct.pack("!Q", size)
        masked = bytes(value ^ mask[index % 4] for index, value in enumerate(data))
        self.sock.sendall(header + mask + masked)

    def receive(self):
        first, second = read_exact(self.sock, 2)
        opcode = first & 0x0F
        size = second & 0x7F
        if size == 126:
            size = struct.unpack("!H", read_exact(self.sock, 2))[0]
        elif size == 127:
            size = struct.unpack("!Q", read_exact(self.sock, 8))[0]
        mask = read_exact(self.sock, 4) if second & 0x80 else None
        data = read_exact(self.sock, size)
        if mask:
            data = bytes(value ^ mask[index % 4] for index, value in enumerate(data))
        if opcode == 8:
            raise ConnectionError("Chrome closed the DevTools WebSocket")
        if opcode == 9:
            self.sock.sendall(bytes((0x8A, len(data))) + data)
            return None
        return json.loads(data.decode("utf-8")) if opcode == 1 else None

    def evaluate(self, expression):
        command_id = self.next_id
        self.next_id += 1
        self.send({"id": command_id, "method": "Runtime.evaluate", "params": {
            "expression": expression, "returnByValue": True, "awaitPromise": True,
        }})
        while True:
            message = self.receive()
            if not message:
                continue
            if message.get("method"):
                self.events.append(message)
            if message.get("method") == "Page.javascriptDialogOpening":
                self.send({"id": self.next_id, "method": "Page.handleJavaScriptDialog", "params": {"accept": True}})
                self.next_id += 1
            if message.get("id") != command_id:
                continue
            if "error" in message:
                raise RuntimeError(message["error"].get("message", "CDP evaluation failed"))
            return message.get("result", {}).get("result", {}).get("value")


def main():
    cdp = Cdp(PAGE_URL)
    cdp.send({"id": cdp.next_id, "method": "Runtime.enable"})
    cdp.next_id += 1
    cdp.send({"id": cdp.next_id, "method": "Page.enable"})
    cdp.next_id += 1
    for method in ("Network.enable", "Log.enable"):
        cdp.send({"id": cdp.next_id, "method": method})
        cdp.next_id += 1
    if os.environ.get("RELOAD_TEST_PAGE") == "1":
        cdp.send({"id": cdp.next_id, "method": "Page.reload", "params": {"ignoreCache": True}})
        cdp.next_id += 1
        time.sleep(0.5)
    deadline = time.monotonic() + 180
    last_results = ""
    while time.monotonic() < deadline:
        try:
            state = cdp.evaluate("({title:document.title,url:location.href,results:document.querySelector('#results')?.textContent || '',cards:document.querySelector('#app')?.contentDocument?.querySelectorAll('.project-card').length,message:document.querySelector('#app')?.contentDocument?.querySelector('#project-message')?.textContent,hidden:document.querySelector('#app')?.contentDocument?.querySelector('#project-message')?.hidden})")
        except (TimeoutError, socket.timeout):
            continue
        if state and state["results"] != last_results:
            last_results = state["results"]
            print(last_results, flush=True)
        if state and state["title"].startswith(("PASS", "FAIL")):
            request_urls = {
                event["params"]["requestId"]: event["params"].get("request", {}).get("url", "")
                for event in cdp.events if event.get("method") == "Network.requestWillBeSent"
            }
            failed_requests = [
                {"url": request_urls.get(event["params"].get("requestId"), ""),
                 "error": event["params"].get("errorText", "")}
                for event in cdp.events if event.get("method") == "Network.loadingFailed"
            ]
            console_errors = [
                event["params"].get("entry", {}).get("text", "")
                for event in cdp.events if event.get("method") == "Log.entryAdded"
                and event.get("params", {}).get("entry", {}).get("level") == "error"
            ]
            print(json.dumps({"failedRequests": failed_requests, "consoleErrors": console_errors}, ensure_ascii=False), flush=True)
            if state["title"].startswith("FAIL"):
                print(json.dumps({key: state.get(key) for key in ("url", "cards", "message", "hidden")}, ensure_ascii=False), flush=True)
                raise SystemExit(1)
            return
        time.sleep(0.2)
    raise SystemExit("Timed out waiting for tests/projects_browser.html; last state:\n" + last_results)


if __name__ == "__main__":
    main()
