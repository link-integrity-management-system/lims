import model_utils from "/home/ubuntu/app/shared/database_js/model_utils.js";
// const utils = require("/home/ubuntu/app/shared/utils_js/utils");

const INTEGRITY_POLICY_TYPE_VALUES = ["location", "content", "context"];
const INTEGRITY_POLICY_STRATEGY_VALUES = ["simple"];

function setSourceElasticID(data, docID) {
    data.sourceElasticID = docID;
}

function getSourceElasticID(data) {
    return data.sourceElasticID;
}

function setDoubleSourceElasticID(data, docID) {
    data.doubleSourceElasticID = docID;
}

function getDoubleSourceElasticID(data) {
    return data.doubleSourceElasticID;
}

function setTripleSourceElasticID(data, docID) {
    data.tripleSourceElasticID = docID;
}

function getTripleSourceElasticID(data) {
    return data.tripleSourceElasticID;
}

class IntegrityPolicyStrategy {
    static Simple = new IntegrityPolicyStrategy("simple");

    constructor(name) {
        if (!INTEGRITY_POLICY_STRATEGY_VALUES.includes(name)) {
            throw new Error(`Unknown IntegrityPolicyStrategy: ${name}`);
        }
        this.name = name;
    }

    toString() {
        return `${this.name}`;
    }

    export() {
        return this.toString();
    }
}

class IntegrityPolicyType {
    static Location = new IntegrityPolicyType("location");
    static Content = new IntegrityPolicyType("content");
    static Context = new IntegrityPolicyType("context");

    constructor(name) {
        if (!INTEGRITY_POLICY_TYPE_VALUES.includes(name)) {
            throw new Error(`Unknown IntegrityPolicyType: ${name}`);
        }
        this.name = name;
    }

    toString() {
        return `${this.name}`;
    }

    export() {
        return this.toString();
    }
}

class ElasticDocument {
    constructor(doc) {
        this._id = doc._id;
    }

    parseHeaders(headers) {
        this.headers = {};
        for (const [key, val] of Object.entries(headers)) {
            const name = key.replaceAll("'", "").toLowerCase();
            this.headers[name] = val;
        }
    }

    export() {
        const obj = {};
        const keys = Object.keys(this);
        for (const key of keys) {
            obj[key] = this[key];
        }
        return obj;
    }
}

class DomainUrl extends ElasticDocument {
    constructor(params) {
        super(params);
        this.domain = params.domain;
        this.url = params.url;
        this.headers = params.headers;
    }
}

class ExternalLink extends ElasticDocument {
    constructor(params) {
        super(params);
        this.originSource = params.originSource;
        this.originTarget = params.originTarget;
        this.urlSource = params.urlSource;
        this.urlTarget = params.urlTarget;
        this.fromClient = params.fromClient;
    }
}

class LinkStatus extends ElasticDocument {
    constructor(params) {
        super(params);
        this.status = params.status;
        this.lastChecked = params.lastChecked;
    }
}

class IntegrityPolicy extends ElasticDocument {
    constructor(params) {
        super(params);
        this.name = params.name;
        this.strategy = new IntegrityPolicyStrategy(params.strategy);
        this.type = new IntegrityPolicyType(params.type); // policy type
        this.originSource = params.originSource; // source of the policy
        this.originTarget = params.originTarget; // target of the policy
        this.urlSource = params.urlSource;
        this.urlTarget = params.urlTarget;
        this.created = params.created; // creation time
        this.expired = params.expired; // expiration time
        this.description = params.description; // text description
        this.verifyFn = params.verifyFn; // verification function
        this.verifyFnOutput = params.verifyFnOutput; // expected verification function output
        this.duration = params.duration;    // duration of verification decision
        this.extraArgs = params.extraArgs;
    }

    export() {
        const obj = {};
        const keys = Object.keys(this);
        for (const key of keys) {
            if (key !== "type") {
                obj[key] = this[key];
                continue;
            }
            obj[key] = this[key].export();
        }
        return obj;
    }
}

class PolicyVerification extends ElasticDocument {
    constructor(params) {
        super(params);
        this.time = params.time; // time of verification
        this.policyId = params.policyId; // id of the IntegrityPolicy
        this.originSource = params.originSource; // source of the policy
        this.originTarget = params.originTarget; // target of the policy
        this.urlSource = params.urlSource; // url of source domain
        this.urlTarget = params.urlTarget; // url of target domain
        this.outputExpected = params.outputExpected; // expected verification function output
        this.outputActual = params.outputActual; // actual verification function output
        this.success = params.success; // boolean
    }
}

class RequestInfo extends ElasticDocument {
    constructor(params) {
        super(params);
        const request = params.request;
        this.time = model_utils.getUTCDateSeconds(params.wallTime);
        this.hasUserGesture = params.hasUserGesture;
        this.type = params.type;
        this.documentUrl = params.documentURL;
        // this.usedSri = params.usedSri; // matchScriptTagsAndRequests
        // this.sriIntegrity = params.sriIntegrity; // matchScriptTagsAndRequests
        // this.sriMatch = params.sriMatch; // matchScriptTagsAndRequests
        // this.foundNode = params.foundNode; // matchScriptTagsAndRequests
        this.originalUrl = params.originalRequestUrl; // annotateOriginalRequestUrls
        this.isExternal = params.isExternal; // annotateExternalRequests
        this.url = request.url;
        this.urlFragment = request.urlFragment;
        this.method = request.method;
        this.postData = request.postData;
        this.hasPostData = request.hasPostData;
        this.mixedContent = request.mixedContentType;
        this.initialPriority = request.initialPriority;
        this.referrerPolicy = request.referrerPolicy;
        this.linkPreload = request.isLinkPreload;
        this.failedRetryCount = params.failedRetryCount; // failedRequestWasRetried
        this.wasRetried = params.wasRetried; // filterRequestedInfo
        this.loadFailedError = params.loadingFailedError;
        this.loadFailedCanceled = params.loadingFailedCanceled;
        this.loadFailedBlocked = params.loadingFailedBlocked;
        this.loadFailedCors = params.loadingFailedCors;
        this.initiator = new InitiatorInfo(params);
        this.parseHeaders(request.headers);
    }
}

class ResponseInfo extends ElasticDocument {
    constructor(params) {
        super(params);
        const response = params.response;
        this.url = response.url;
        this.status = response.status;
        this.mimeType = response.mimeType;
        // this.connectionReused = response.connectionReused;
        this.remoteIPAddress = response.remoteIPAddress;
        // this.remoteIPASN = response.remoteIPASN;
        // this.remoteIPOrg = response.remoteIPOrg;
        this.remotePort = response.remotePort;
        this.fromDiskCache = response.fromDiskCache;
        this.fromServiceWorker = response.fromServiceWorker;
        this.fromPrefetchCache = response.fromPrefetchCache;
        this.encodedDataLength = response.encodedDataLength;
        // this.timing = {};    // CONSIDER: do we need this?
        this.serviceWorkerResponseSource = response.serviceWorkerResponseSource;
        this.time = model_utils.getUTCDateSeconds(response.responseTime / 1000); // actually in ms, CDP documentation is wrong
        this.cacheStorageCacheName = response.cacheStorageCacheName;
        this.protocol = response.protocol;
        this.securityState = response.securityState;
        // this.respSecurityDetails = {};   // CONSIDER: do we need this?
        this.parseHeaders(response.headers);
    }
}

// class RequestData extends ElasticDocument {
//     constructor(data) {
//         super(params);
//         this.reqParams = new RequestInfo(data.reqParams);
//         this.respParams = data.respParams
//             ? new ResponseInfo(data.respParams)
//             : undefined;
//         // script tag
//         this.scriptTag = data.scriptTag;

//         // sources
//         const sourceElasticID = getSourceElasticID(data);
//         if (sourceElasticID) {
//             // save sources first
//             this.sourceID = sourceElasticID;
//         } else {
//             this.source = data.source;
//         }
//         const doubleSourceElasticID = getDoubleSourceElasticID(data);
//         if (doubleSourceElasticID) {
//             this.doubleFetchSrcID = doubleSourceElasticID;
//         } else {
//             this.doubleFetchSrc = data.doubleFetchSrc;
//         }
//         this.diffDoubleFetch = data.diffDoubleFetch;
//         const tripleSourceElasticID = getTripleSourceElasticID(data);
//         if (tripleSourceElasticID) {
//             this.tripleFetchSrcID = tripleSourceElasticID;
//         } else {
//             this.tripleFetchSrc = data.tripleFetchSrc;
//         }
//         this.diffTripleFetch = data.diffTripleFetch;
//     }
// }

class ResponseBody extends ElasticDocument {
    constructor(data) {
        super(data);
        this.bodyBinary = data.bodyBinary;
        this.bodyText = data.bodyText;
        this.base64Encoded = data.base64Encoded;
    }
}

class RequestData extends ElasticDocument {
    constructor(data) {
        super(data);
        this.domain = data.domain;
        this.requestID = data.requestID;
        this.cdpType = data.respParams
            ? data.respParams.type
            : undefined;
        this.reqParams = new RequestInfo(data.reqParams);
        this.respParams = data.respParams
            ? new ResponseInfo(data.respParams)
            : undefined;
        this.response = data.response
            ? new ResponseBody(data.response) :
            undefined;
    }
}

class DomainPageData extends ElasticDocument {
    constructor(data) {
        super(params);
        this.domain = data.domain;
        this.timing = data.timing;
        this.reqUrl = data.reqUrl;
        this.pageUrl = data.pageUrl;
        this.requestedScripts = {};
        for (const [requestId, requestData] of Object.entries(
            data.requestedScripts
        )) {
            this.requestedScripts[requestId] = new RequestData(requestData);
        }
        this.requestIdOrder = data.requestIdOrder;
        this.originalRequestUrls = data.originalRequestUrls;
        this.inlines = [];
        for (const inline of data.inlines) {
            this.inlines.push(new InlineScript(inline));
        }
        this.unmatched = [];
        for (const unmatched of data.unmatched) {
            this.unmatched.push(new UnmatchedScript(unmatched));
        }
        this.html = data.compressedHTML;
        this.failedSriUrls = data.failedSriUrls;
        this.noHTMLNodes = data.noHTMLNodes;
    }

    // not actually necessary to filter atm
    // export() {
    //     // only keep the non-script request/responses
    //     const obj = {};
    //     const keys = Object.keys(this);
    //     for (const key of keys) {
    //         if (key !== "requestedScripts") {
    //             obj[key] = this[key];
    //             continue;
    //         }
    //         const requestedInfo = {};
    //         for (const [requestId, requestData] of Object.entries(this[key])) {
    //             if (!utils.isRequestDataScript(requestData)) {
    //                 requestedInfo[requestId] = requestData;
    //             }
    //         }
    //         obj[key] = requestedInfo;
    //     }
    //     return obj;
    // }
}

class Source extends ElasticDocument {
    constructor(source) {
        super(params);
        this.hash = model_utils.getScriptHashDigest(source);
        this.source = source;
    }
}

class InitiatorInfo extends ElasticDocument {
    constructor(params) {
        super(params);
        const initiator = params.initiator;
        this.initType = initiator.type;
        this.initLineNumber = initiator.lineNumber;
        this.initColNumber = initiator.columnNumber;
        this.initTime = model_utils.getUTCDateSeconds(params.wallTime);
        this.initUrl = model_utils.getInitiatorUrls(initiator)[0];
    }
}

export default {
    IntegrityPolicyType,
    DomainUrl,
    ExternalLink,
    LinkStatus,
    IntegrityPolicy,
    PolicyVerification,
    DomainPageData,
    Source,
    InitiatorInfo,
    RequestData,
};
