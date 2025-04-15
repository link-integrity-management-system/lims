"""Write flow objects to a HAR file
source: https://github.com/mitmproxy/mitmproxy/blob/main/mitmproxy/addons/savehar.py
"""


import base64
import json
import logging
import zlib
from collections.abc import Sequence
from datetime import datetime
from datetime import timezone
from typing import Any
from pathlib import Path
import re

from mitmproxy import command
from mitmproxy import ctx
from mitmproxy import exceptions
from mitmproxy import flow
from mitmproxy import flowfilter
from mitmproxy import http
from mitmproxy import types
from mitmproxy import version
from mitmproxy.connection import Server
from mitmproxy.coretypes.multidict import _MultiDict
from mitmproxy.log import ALERT
from mitmproxy.utils import human
from mitmproxy.utils import strutils

from utils.script_attributes import attributes

logger = logging.getLogger(__name__)


TEST_DOMAIN = "<PLACEHOLDER>"

class SaveHAR:
    def __init__(self) -> None:
        self.flows: dict[str, list[flow.Flow]] = {}
        self.filt: flowfilter.TFilter | None = None
        self.worker_key_ua_ptrn: re.Pattern = re.compile("worker-lms\/([0-9]{1,2})$")
        # don't think it is possible to add an extra header on every request
        # with a vanilla browser
        # self.worker_key_header: str = "LMS-Worker"
        self.start_har_req_url: str = f"{TEST_DOMAIN}/start-har"
        self.save_har_req_url: str = f"{TEST_DOMAIN}/save-har"
        self.base_har_dir: Path = Path("/root/.mitmproxy/hars")
        self.base_har_dir.mkdir(exist_ok=True)

    def export_har(self, flows: Sequence[flow.Flow], path: types.Path) -> None:
        """Export flows to an HAR (HTTP Archive) file."""

        har = json.dumps(self.make_har(flows), indent=4).encode()

        if path.endswith(".zhar"):
            har = zlib.compress(har, 9)

        with open(path, "wb") as f:
            f.write(har)

        logging.log(ALERT, f"HAR file saved ({human.pretty_size(len(har))} bytes).")

    def make_har(self, flows: Sequence[flow.Flow]) -> dict:
        entries = []
        skipped = 0
        # A list of server seen till now is maintained so we can avoid
        # using 'connect' time for entries that use an existing connection.
        servers_seen: set[Server] = set()

        for f in flows:
            if isinstance(f, http.HTTPFlow):
                entries.append(self.flow_entry(f, servers_seen))
            else:
                skipped += 1

        if skipped > 0:
            logger.info(f"Skipped {skipped} flows that weren't HTTP flows.")

        return {
            "log": {
                "version": "1.2",
                "creator": {
                    "name": "mitmproxy",
                    "version": version.VERSION,
                    "comment": "",
                },
                "pages": [],
                "entries": entries,
            }
        }

    def load(self, l):
        l.add_option(
            "hardump",
            str,
            "",
            """
            Save a HAR file with all flows on exit.
            You may select particular flows by setting save_stream_filter.
            For mitmdump, enabling this option will mean that flows are kept in memory.
            """,
        )

    # def configure(self, updated):
    #     if "save_stream_filter" in updated:
    #         if ctx.options.save_stream_filter:
    #             try:
    #                 self.filt = flowfilter.parse(ctx.options.save_stream_filter)
    #             except ValueError as e:
    #                 raise exceptions.OptionsError(str(e)) from e
    #         else:
    #             self.filt = None

    #     if "hardump" in updated:
    #         if not ctx.options.hardump:
    #             self.flows = {}

    def _get_worker_key(self, flow: http.HTTPFlow) -> None:
        # determine the worker key from a header
        ua = flow.request.headers.get("User-Agent", "lms-00")
        worker = self.worker_key_ua_ptrn.search(ua).groups()[0]
        return worker

    def request(self, flow: http.HTTPFlow) -> None:
        print(f"request url {flow.request.url}")
        if self.start_har_req_url in flow.request.url:
            worker_key = self._get_worker_key(flow)
            self.flows[worker_key] = []
            flow.response = http.Response.make(200, "OK")
        if self.save_har_req_url in flow.request.url:
            worker_key = self._get_worker_key(flow)
            fname = f"{worker_key}-{flow.request.query['fname']}"
            path = self.base_har_dir / fname
            flows = self.flows.get(worker_key, [])
            print(f"----HAR SAVE REQUESTED")
            print(f"----  FOR worker={worker_key}")
            print(f"----  num_flows={len(flows)}")
            print(f"----  path={path}")
            try:
                self.export_har(flows, str(path))
                if worker_key in self.flows:
                    del self.flows[worker_key]
                flow.response = http.Response.make(200, "OK")
            except Exception as exc:
                flow.response = http.Response.make(500, f"Err: {exc}")

    def response(self, flow: http.HTTPFlow) -> None:
        # websocket flows will receive a websocket_end,
        # we don't want to persist them here already
        if flow.websocket is None and self.save_har_req_url not in flow.request.url:
            self._save_flow(flow)

    def error(self, flow: http.HTTPFlow) -> None:
        self.response(flow)

    def websocket_end(self, flow: http.HTTPFlow) -> None:
        self._save_flow(flow)

    def _save_flow(self, flow: http.HTTPFlow) -> None:
        if ctx.options.hardump:
            flow_matches = self.filt is None or self.filt(flow)
            if flow_matches:
                worker_key = self._get_worker_key(flow)
                # only save flow if requested
                if worker_key not in self.flows:
                    return
                self.flows[worker_key].append(flow)

    # def done(self):
    #     if ctx.options.hardump:
    #         if ctx.options.hardump == "-":
    #             har = self.make_har(self.flows)
    #             print(json.dumps(har, indent=4))
    #         else:
    #             self.export_har(self.flows, ctx.options.hardump)

    def flow_entry(self, flow: http.HTTPFlow, servers_seen: set[Server]) -> dict:
        """Creates HAR entry from flow"""

        if flow.server_conn in servers_seen:
            connect_time = -1.0
            ssl_time = -1.0
        elif flow.server_conn.timestamp_tcp_setup:
            assert flow.server_conn.timestamp_start
            connect_time = 1000 * (
                flow.server_conn.timestamp_tcp_setup - flow.server_conn.timestamp_start
            )

            if flow.server_conn.timestamp_tls_setup:
                ssl_time = 1000 * (
                    flow.server_conn.timestamp_tls_setup - flow.server_conn.timestamp_tcp_setup
                )
            else:
                ssl_time = None
            servers_seen.add(flow.server_conn)
        else:
            connect_time = None
            ssl_time = None

        if flow.request.timestamp_end:
            send = 1000 * (flow.request.timestamp_end - flow.request.timestamp_start)
        else:
            send = 0

        if flow.response and flow.request.timestamp_end:
            wait = 1000 * (flow.response.timestamp_start - flow.request.timestamp_end)
        else:
            wait = 0

        if flow.response and flow.response.timestamp_end:
            receive = 1000 * (flow.response.timestamp_end - flow.response.timestamp_start)

        else:
            receive = 0

        timings: dict[str, float | None] = {
            "connect": connect_time,
            "ssl": ssl_time,
            "send": send,
            "receive": receive,
            "wait": wait,
        }

        if flow.response:
            response_body_size = len(flow.response.raw_content) if flow.response.raw_content else 0
            response_body_decoded_size = len(flow.response.content) if flow.response.content else 0
            response_body_compression = response_body_decoded_size - response_body_size
            response = {
                "status": flow.response.status_code,
                "statusText": flow.response.reason,
                "httpVersion": flow.response.http_version,
                "cookies": self.format_response_cookies(flow.response),
                "headers": self.format_multidict(flow.response.headers),
                "content": {
                    "size": response_body_size,
                    "compression": response_body_compression,
                    "mimeType": flow.response.headers.get("Content-Type", ""),
                },
                "redirectURL": flow.response.headers.get("Location", ""),
                "headersSize": len(str(flow.response.headers)),
                "bodySize": response_body_size,
            }
            # -------------
            # MODIFIED HERE
            # -------------
            # if flow.response.content and strutils.is_mostly_bin(flow.response.content):
            #     response["content"]["text"] = base64.b64encode(flow.response.content).decode()
            #     response["content"]["encoding"] = "base64"
            # else:
            #     response["content"]["text"] = flow.response.get_text(strict=False)
            ends_with_js = flow.request.url.endswith(".js")
            resp_content_type = ""
            for k, v in flow.response.headers.items():
                if k.lower() == "content-type":
                    resp_content_type = v
            resp_content_type_script = resp_content_type.find("javascript") > -1
            is_script = ends_with_js or resp_content_type_script
            if flow.response.content and is_script:
                script = flow.response.get_text(strict=False)
                static_attrs = attributes.extract_static_attrs(script)
                ast_attrs = attributes.extract_ast_attrs(script)
                response["content"]["script_attrs"] = dict(
                    sicilian_sig=ast_attrs["sicilian_sig"],
                    sicilian_sig_noliteral=ast_attrs["sicilian_sig_noliteral"],
                    keywords=static_attrs["keywords"],
                    struct_raw=static_attrs["struct_raw"],
                )
        else:
            response = {
                "status": 0,
                "statusText": "",
                "httpVersion": "",
                "headers": [],
                "cookies": [],
                "content": {},
                "redirectURL": "",
                "headersSize": -1,
                "bodySize": -1,
                "_transferSize": 0,
                "_error": None,
            }
            if flow.error:
                response["_error"] = flow.error.msg

        entry: dict[str, Any] = {
            "startedDateTime": datetime.fromtimestamp(
                flow.request.timestamp_start, timezone.utc
            ).isoformat(),
            "time": sum(v for v in timings.values() if v is not None and v >= 0),
            "request": {
                "method": flow.request.method,
                "url": flow.request.pretty_url,
                "httpVersion": flow.request.http_version,
                "cookies": self.format_multidict(flow.request.cookies),
                "headers": self.format_multidict(flow.request.headers),
                "queryString": self.format_multidict(flow.request.query),
                "headersSize": len(str(flow.request.headers)),
                "bodySize": len(flow.request.content) if flow.request.content else 0,
            },
            "response": response,
            "cache": {},
            "timings": timings,
        }

        if flow.request.method in ["POST", "PUT", "PATCH"]:
            params = self.format_multidict(flow.request.urlencoded_form)
            entry["request"]["postData"] = {
                "mimeType": flow.request.headers.get("Content-Type", ""),
                "text": flow.request.get_text(strict=False),
                "params": params,
            }

        if flow.server_conn.peername:
            entry["serverIPAddress"] = str(flow.server_conn.peername[0])

        websocket_messages = []
        if flow.websocket:
            for message in flow.websocket.messages:
                if message.is_text:
                    data = message.text
                else:
                    data = base64.b64encode(message.content).decode()
                websocket_message = {
                    "type": "send" if message.from_client else "receive",
                    "time": message.timestamp,
                    "opcode": message.type.value,
                    "data": data,
                }
                websocket_messages.append(websocket_message)

            entry["_resourceType"] = "websocket"
            entry["_webSocketMessages"] = websocket_messages
        return entry

    def format_response_cookies(self, response: http.Response) -> list[dict]:
        """Formats the response's cookie header to list of cookies"""
        cookie_list = response.cookies.items(multi=True)
        rv = []
        for name, (value, attrs) in cookie_list:
            cookie = {
                "name": name,
                "value": value,
                "path": attrs["path"],
                "domain": attrs.get("domain", ""),
                "httpOnly": "httpOnly" in attrs,
                "secure": "secure" in attrs,
            }
            # TODO: handle expires attribute here.
            # This is not quite trivial because we need to parse random date formats.
            # For now, we just ignore the attribute.

            if "sameSite" in attrs:
                cookie["sameSite"] = attrs["sameSite"]

            rv.append(cookie)
        return rv

    def format_multidict(self, obj: _MultiDict[str, str]) -> list[dict]:
        return [{"name": k, "value": v} for k, v in obj.items(multi=True)]
