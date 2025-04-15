/* ---------------- CONSTANTS ---------------- */
const API_ADDRESS = "https://127.0.0.1:5001";
const ENDPOINT_VAPIDPUBLICKEY = `${API_ADDRESS}/clients/vapidPublicKey`;
const ENDPOINT_REGISTERPUSH = `${API_ADDRESS}/clients/register`;
const SW_PATH = "/lms-worker.js";

const MESSAGE_TYPE = {
    RELOAD: "reload",
    REREGISTER: "reregister",
    EXTRACT_LINKS: "extract-links",
    FORCE_ACTIVATE: "force-activate",
    ACTIVE_TAB: "active-tab",
    UPDATE_MODE: "update-mode",
    ENDPOINT_USAGE: "endpoint-usage",
    CLEAR_CACHE: "clear-cache",
};
const SW_RESPONSES = {
    [MESSAGE_TYPE.ENDPOINT_USAGE]: null,
    [MESSAGE_TYPE.CLEAR_CACHE]: null,
};
let WAIT_FOR_SW_TIMEOUT = 5000;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------------- HELPERS ---------------- */

/**
 * Extracts a link to another resource in a given element.
 * @param {Element} tag the target element from which to extract a link
 * @returns link to another resource, or null
 */
function extractLinkFromTag(tag) {
    const tagName = tag.className.toLowerCase();
    let attr = null;
    switch (tagName) {
        case "a":
        case "link":
            attr = "href";
            break;
        case "img":
        case "script":
            attr = "src";
            break;
        default:
            break;
    }
    return tag.hasAttribute(attr) ? tag.getAttribute(attr) : null;
}

/**
 * Extracts all resource links from an HTML document.
 * @param {string} rawHTML raw HTML
 * @returns all resource links in the given HTML
 */
function extractLinks(rawHTML) {
    const doc = document.createElement("html");
    doc.innerHTML = rawHTML;
    const tags = ["a", "link", "img", "script"];
    // const links = [];
    // for (const tagType of tags) {
    //     for (const tag of doc.getElementsByTagName(tagType)) {
    //         const link = extractLinkFromTag(tag);
    //         if (link) {
    //             links.push(link);
    //         }
    //     }
    // }
    const links = tags
        .map((t) => doc.getElementsByTagName(t))
        .flat()
        .map((tag) => tag.href || tag.src)
        .filter(Boolean);
    return links;
}

function reloadPage() {
    window.location.reload();
    console.debug(`[register-sw]: reloaded page...`);
}

/* ---------------- HANDLERS ---------------- */

/**
 * Event handler for messages.
 * @param {MessageEvent} event message event
 */
function onMessageEvent(event) {
    if (!event.data) {
        return;
    }
    const msgType = event.data.type;
    console.log(`[register-sw]: message ${msgType}`);

    switch (msgType) {
        case MESSAGE_TYPE.RELOAD:
            reloadPage();
            break;
        case MESSAGE_TYPE.REREGISTER:
            unregisterSW();
            break;
        case MESSAGE_TYPE.EXTRACT_LINKS:
            const links = extractLinks(event.data.data);
            navigator.serviceWorker.controller.postMessage({
                type: MESSAGE_TYPE.EXTRACT_LINKS,
                url: event.data.url,
                data: links,
            });
            break;
        case MESSAGE_TYPE.ENDPOINT_USAGE:
        case MESSAGE_TYPE.CLEAR_CACHE:
            SW_RESPONSES[msgType] = event.data.data;
            break;
        default:
            break;
    }
}

/* ---------------- REGISTRATIONS ---------------- */

/**
 * Registers the service worker.
 */
async function registerServiceWorker() {
    // check if service workers are supported
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.addEventListener("message", onMessageEvent);
        try {
            const registration = await navigator.serviceWorker.register(
                SW_PATH,
                { scope: "/" }
            );
            if (registration.active) {
                const newWorker = registration.active;
                newWorker.postMessage({
                    type: MESSAGE_TYPE.UPDATE_MODE,
                    ua: navigator.userAgent,
                });
            }
            registration.addEventListener("updatefound", (event) => {
                // a new service worker is being installed
                const newWorker = registration.installing;
                newWorker.addEventListener("statechange", () => {
                    console.log(
                        `[register-sw]: newWorker state ${newWorker.state}`
                    );

                    // waiting to activate
                    if (newWorker.state === "installed") {
                        newWorker.postMessage({
                            type: "force-activate",
                            ua: navigator.userAgent,
                        });
                    }

                    // reload page so that the service worker takes control
                    // of all requests made, including those that were finished
                    // before the service worker was first loaded
                    if (newWorker.state === "activated") {
                        reloadPage();
                    }
                });
            });
        } catch (err) {
            console.error(
                `[register-sw]: error with service worker installation...`,
                err
            );
        }
    }
}

/**
 * Registers the service worker for a web push subscription.
 */
async function registerPushSubscription() {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (subscription) {
        return;
    }

    const response = await fetch(ENDPOINT_VAPIDPUBLICKEY);
    const vapidPublicKey = await response.text();
    subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidPublicKey,
    });

    fetch(ENDPOINT_REGISTERPUSH, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            subscription: subscription,
        }),
    });
}

let PROP_HIDDEN;
let EVENT_VISIBILITY_CHANGE;

function handleVisiblityChange() {
    console.debug(
        `document hidden ${document[PROP_HIDDEN]} ${self.location.href}`
    );
    if (!document[PROP_HIDDEN]) {
        navigator.serviceWorker.controller.postMessage({
            type: MESSAGE_TYPE.ACTIVE_TAB,
            url: window.location.href,
        });
    }
}

function registerPageChangeListener() {
    if (typeof document.PROP_HIDDEN !== "undefined") {
        // Opera 12.10 and Firefox 18 and later support
        PROP_HIDDEN = "hidden";
        EVENT_VISIBILITY_CHANGE = "visibilitychange";
    } else if (typeof document.msHidden !== "undefined") {
        PROP_HIDDEN = "msHidden";
        EVENT_VISIBILITY_CHANGE = "msvisibilitychange";
    } else if (typeof document.webkitHidden !== "undefined") {
        PROP_HIDDEN = "webkitHidden";
        EVENT_VISIBILITY_CHANGE = "webkitvisibilitychange";
    }
    document.addEventListener(
        EVENT_VISIBILITY_CHANGE,
        handleVisiblityChange,
        false
    );
}

async function waitForSWResp(msgType) {
    if (!("serviceWorker" in navigator)) {
        return;
    }
    const registration = await navigator.serviceWorker.register(SW_PATH, {
        scope: "/",
    });
    if (registration.active) {
        const newWorker = registration.active;
        newWorker.postMessage({
            type: msgType,
        });
        const start = Date.now();
        let elapsed = 0;
        while (elapsed < WAIT_FOR_SW_TIMEOUT) {
            if (SW_RESPONSES[msgType] != null) {
                break;
            }
            await sleep(1000);
            elapsed = Date.now() - start;
        }
    }
    return SW_RESPONSES[msgType];
}

async function getSWEndpointUsage() {
    return await waitForSWResp(MESSAGE_TYPE.ENDPOINT_USAGE);
}

async function clearSWCache() {
    return await waitForSWResp(MESSAGE_TYPE.CLEAR_CACHE);
}

async function unregisterSW() {
    if (!("serviceWorker" in navigator)) {
        return;
    }
    const registration = await navigator.serviceWorker.register(SW_PATH, {
        scope: "/",
    });
    try {
        const success = await registration.unregister();
        console.debug(`[register-sw]: unregisterSW success=${success}`);
        if (success) {
            reloadPage();
        }
    } catch (err) {
        console.debug(`[register-sw]: unregisterSW err=${err}`);
    }
}

registerServiceWorker();
// registerPushSubscription(); // TODO: don't register push for now
registerPageChangeListener();
