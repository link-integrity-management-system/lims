import os

from mitmproxy import ctx

from sw_injector import SWInjector
from save_har import SaveHAR

addons = []

MODULE_MAPPING = {
    "LMS_PROXY_SW_INJECTOR": SWInjector,
    "LMS_PROXY_SAVEHAR": SaveHAR,
}


def load_modules():
    for env_key, module in MODULE_MAPPING.items():
        try:
            if os.getenv(env_key, "").lower() == "true":
                addons.append(module())
                print(f"Loaded {env_key}")
        except KeyError:
            pass


load_modules()
