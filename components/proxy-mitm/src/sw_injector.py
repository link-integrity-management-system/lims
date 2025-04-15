from bs4 import BeautifulSoup
from mitmproxy import http


def is_html_response(flow):
    """Checks whether or not the response is an HTML response by examining
    the flow response headers.
    Args:
        flow (mitmproxy.flow.Flow): mitmproxy abstraction of a network flow
    Returns:
        bool: whether the response is an HTML response
    """
    temp_headers = {k.lower(): v for k, v in flow.response.headers.items()}
    is_html = flow.response.content is not None
    is_html = is_html and "content-type" in temp_headers
    is_html = is_html and "text/html" in temp_headers["content-type"]
    return is_html


def is_redirect_response(flow):
    is_redirect = flow.response.status_code >= 300
    is_redirect = is_redirect and flow.response.status_code < 400
    return is_redirect


def response_404(flow):
    flow.response = http.Response.make(404, "", {"Content-Type": "text/plain"})


PATH_REGISTER_SW = "/register-sw.js"
PATH_LMS_WORKER = "/lms-worker.js"
DEFAULT_BACKEND = "127.0.0.1:5001"
TEST_DOMAIN = "<PLACEHOLDER>"


def parse_backend_from_ua(ua):
    backend = DEFAULT_BACKEND
    search_str = "backend="
    idx = ua.find(search_str)
    if idx > -1:
        backend = ua[idx + len(search_str) :]
        idx_space = backend.find(" ")
        if idx_space > -1:
            backend = backend[:idx_space]
    return backend


class SWInjector:
    """mitmproxy addon responsible for injecting the LMS service worker"""

    def __init__(self):
        with open("service-worker/register-sw.js") as f:
            self.script_reg = f.read()
        with open("service-worker/lms-worker.js") as f:
            self.script_sw = f.read()
        self.script_header_content_type = {"Content-Type": "text/javascript"}

    def request(self, flow):
        # print(flow.request.headers)
        # if "upgrade" in flow.request.headers:
        #     print(f"found upgrade request...")
        #     return

        ua = flow.request.headers["user-agent"]
        backend = parse_backend_from_ua(ua)
        is_register_sw = flow.request.path == PATH_REGISTER_SW
        is_lms_worker = flow.request.path == PATH_LMS_WORKER
        script = None

        if is_register_sw:
            script = self.script_reg
        elif is_lms_worker:
            script = self.script_sw

            # client SW mode
            if "noop-sw" in ua:
                script = script.replace(
                    "LMS_MODE = LMS_MODES.NORMAL;", "LMS_MODE = LMS_MODES.NOOP_SW;"
                )
            elif "noop-lms" in ua:
                script = script.replace(
                    "LMS_MODE = LMS_MODES.NORMAL;", "LMS_MODE = LMS_MODES.NOOP_LMS;"
                )

            # server API mode
            if "api-noop" in ua:
                script = script.replace(
                    "API_MODE = API_MODES.NORMAL;", "API_MODE = API_MODES.NOOP;"
                )
            elif "api-discovery" in ua:
                script = script.replace(
                    "API_MODE = API_MODES.NORMAL;", "API_MODE = API_MODES.DISCOVERY;"
                )

            # communication method
            if "comm-http" in ua:
                pass  # default is http
            elif "comm-ws" in ua:
                script = script.replace(
                    "COMM_MODE = COMM_MODES.HTTP;", "COMM_MODE = COMM_MODES.WS;"
                )

        if is_register_sw or is_lms_worker:
            print(
                f"---found lms request with backend={backend} path={flow.request.path} ua={ua}"
            )
            script = script.replace(
                DEFAULT_BACKEND,
                backend,
            )
            if "bare-nginx" in ua:
                script = script.replace(
                    "/links/status`",
                    "/links/status_nginx`",
                )
                script = script.replace(
                    "/links/statuses`",
                    "/links/statuses_nginx`",
                )
            flow.response = http.Response.make(
                200,
                script.encode(),
                self.script_header_content_type,
            )

    def response(self, flow):
        # if "upgrade" in flow.request.headers:
        #     print(f"found upgrade response...")
        #     return

        is_html = is_html_response(flow)
        is_redirect = is_redirect_response(flow)
        is_register_sw_path = flow.request.path == PATH_REGISTER_SW
        is_lms_worker_path = flow.request.path == PATH_LMS_WORKER

        # allow redirects to pass through
        if is_redirect:
            return

        # not a redirect, not HTML
        if not is_html:
            # TODO: slight optimization when running in perf eval mode
            # # minimize caching by responding with 404s
            # if not (is_register_sw_path or is_lms_worker_path):
            #     response_404(flow)
            return

        # for lms eval, ignore
        if TEST_DOMAIN in flow.request.url:
            return

        ua = flow.request.headers["user-agent"]
        if "lms-do-not-inject" in ua:
            return

        print(f"injecting register-sw to {flow.request.url}")
        try:
            soup = BeautifulSoup(flow.response.content, "html.parser")
            new_tag = soup.new_tag("script", src=PATH_REGISTER_SW)
            soup.head.append(new_tag)
            flow.response.content = str(soup).encode("utf8", "ignore")
        except AttributeError:
            print(f"NO HEAD TAG FOR request: {flow.request.url}")
