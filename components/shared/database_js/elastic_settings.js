import config from "/home/ubuntu/app/configs/config.js";


const KEYWORD_IGNORE_ABOVE = 8191;

const INGEST_PIPELINE_TIMESTAMP = {
    name: "timestamp_pipeline",
    settings: {
        description: "Insert a timestamp field for all documents",
        processors: [
            {
                set: {
                    field: "ingest_timestamp",
                    value: "{{_ingest.timestamp}}",
                },
            },
        ],
    },
};

const INGEST_PIPELINE_GEOIP = {
    name: "asn_lookup_pipeline",
    settings: {
        description: "Enrich documents with ASN and country information from respParams.remoteIPAddress",
        processors: [
            {
                "geoip": {
                    "field": "respParams.remoteIPAddress",
                    "target_field": "respParams.geoip_asn",
                    "database_file": "GeoLite2-ASN.mmdb",
                    "properties": ["asn", "organization_name"],
                    "ignore_missing": true
                }
            },
            {
                "script": {
                    "if": "ctx.containsKey('respParams') && ctx.respParams.containsKey('geoip_asn') && ctx.respParams.geoip_asn?.asn != null && ctx.respParams.geoip_asn.asn != ''",
                    "lang": "painless",
                    "source": "ctx.respParams.remoteIPASN = ctx.respParams.geoip_asn.asn"
                }
            },
            {
                "convert": {
                    "field": "respParams.remoteIPASN",
                    "type": "long",
                    "ignore_missing": true,
                }
            },
            {
                "script": {
                    "if": "ctx.containsKey('respParams') && ctx.respParams.containsKey('geoip_asn') && ctx.respParams.geoip_asn?.organization_name != null && ctx.respParams.geoip_asn.organization_name != ''",
                    "lang": "painless",
                    "source": "ctx.respParams.remoteIPOrg = ctx.respParams.geoip_asn.organization_name"
                }
            },
            {
                "remove": {
                    "field": ["respParams.geoip_asn"],
                    "ignore_missing": true
                }
            },
            {
                "geoip": {
                    "field": "respParams.remoteIPAddress",
                    "target_field": "respParams.geoip_location",
                    "database_file": "GeoLite2-City.mmdb",
                    "properties": ["country_name"],
                    "ignore_missing": true
                }
            },

            {
                "script": {
                    "if": "ctx.containsKey('respParams') && ctx.respParams.containsKey('geoip_location') && ctx.respParams.geoip_location?.country_name != null && ctx.respParams.geoip_location.country_name != ''",
                    "lang": "painless",
                    "source": "ctx.respParams.remoteIPCountry = ctx.respParams.geoip_location.country_name"
                }
            },
            {
                "remove": {
                    "field": ["respParams.geoip_location"],
                    "ignore_missing": true
                }
            }
        ]
    }
};

const INGEST_PIPELINE_COMBINED = {
    name: "timestamp_asn_lookup_pipeline",
    settings: {
        "description": "Combines ASN lookup and GeoIP location",
        "processors": [
            {
                "pipeline": {
                    "name": INGEST_PIPELINE_TIMESTAMP.name,
                }
            },
            {
                "pipeline": {
                    "name": INGEST_PIPELINE_GEOIP.name,
                }
            }
        ]
    }
}

const INGEST_PIPELINES = [
    INGEST_PIPELINE_TIMESTAMP,
    INGEST_PIPELINE_GEOIP,
    INGEST_PIPELINE_COMBINED,
]
const NUM_SHARDS = config.elastic.index_settings.num_shards;
const NUM_REPLICAS_PRIMARY = config.elastic.index_settings.num_replicas_primary;
const NUM_REPLICAS_DERIVED = config.elastic.index_settings.num_replicas_derived;
const REFRESH_INTERVAL = config.elastic.index_settings.refresh_interval;
const COMPRESSION_LEVEL = config.elastic.index_settings.compression_level;
const SETTINGS_DEFAULT = {
    index: {
        default_pipeline: INGEST_PIPELINE_TIMESTAMP.name,
        number_of_shards: NUM_SHARDS,
        number_of_replicas: NUM_REPLICAS_PRIMARY,
    },
};
const SETTINGS_ALT = {
    index: {
        default_pipeline: INGEST_PIPELINE_TIMESTAMP.name,
        number_of_shards: NUM_SHARDS,
        number_of_replicas: NUM_REPLICAS_PRIMARY,
        refresh_interval: REFRESH_INTERVAL,
        codec: COMPRESSION_LEVEL,
    },
};
const SETTINGS_FOR_REQUESTS = {
    index: {
        default_pipeline: INGEST_PIPELINE_COMBINED.name,
        number_of_shards: NUM_SHARDS,
        number_of_replicas: NUM_REPLICAS_PRIMARY,
        refresh_interval: REFRESH_INTERVAL,
        codec: COMPRESSION_LEVEL,
    },
};

const PROPERTIES = {
    KEYWORD_ONLY: {
        type: "keyword",
        ignore_above: KEYWORD_IGNORE_ABOVE,
    },
    KEYWORD_TEXT: {
        type: "text",
        fields: {
            keyword: {
                type: "keyword",
                ignore_above: KEYWORD_IGNORE_ABOVE,
            },
        },
    },
};

const INDICES = {
    // push notification subscriptions
    SUBSCRIPTIONS: {
        name: `${config.elastic.prefix}-subscriptions`,
        rotating: false,
        settings: SETTINGS_DEFAULT,
        mappings: {
            properties: {
                endpoint: PROPERTIES.KEYWORD_ONLY,
                expirationTime: { type: "date" },
                keys: {
                    properties: {
                        auth: PROPERTIES.KEYWORD_ONLY,
                        p256dh: PROPERTIES.KEYWORD_ONLY,
                    },
                },
            },
        },
    },
    // TODO: verify safe to remove
    // LMS website URLs
    // DOMAIN_URLS: {
    //     name: `${config.elastic.prefix}-urls`,
    //     rotating: false,
    //     settings: SETTINGS_DEFAULT,
    //     mappings: {
    //         properties: {
    //             domain: PROPERTIES.KEYWORD_ONLY,
    //             url: PROPERTIES.KEYWORD_TEXT,
    //             headers: { type: "boolean" },
    //             latestCrawl: { type: "date" },
    //         },
    //     },
    // },
    // 3p URLs on LMS website URLs
    LINKS: {
        name: `${config.elastic.prefix}-links`,
        rotating: false,
        settings: SETTINGS_DEFAULT,
        mappings: {
            properties: {
                originSource: PROPERTIES.KEYWORD_ONLY,
                originTarget: PROPERTIES.KEYWORD_ONLY,
                urlSource: PROPERTIES.KEYWORD_TEXT,
                urlTarget: PROPERTIES.KEYWORD_TEXT,
                fromClient: { type: "boolean" },
            },
        },
    },
    // old
    // LINK_STATUS: {
    //     name: `${config.elastic.prefix}-link-status`,
    //     rotating: true,
    //     settings: SETTINGS_DEFAULT,
    //     mappings: {
    //         properties: {
    //             linkId: PROPERTIES.KEYWORD_ONLY,
    //             status: PROPERTIES.KEYWORD_ONLY,
    //             hasPolicy: { type: "boolean" },
    //             lastChecked: { type: "date" },
    //         },
    //     },
    // },
    // LMS integrity policies
    POLICIES: {
        name: `${config.elastic.prefix}-policies`,
        rotating: false,
        settings: SETTINGS_DEFAULT,
        mappings: {
            properties: {
                name: PROPERTIES.KEYWORD_ONLY,
                strategy: PROPERTIES.KEYWORD_ONLY, // verification strategy
                type: PROPERTIES.KEYWORD_ONLY,
                originSource: PROPERTIES.KEYWORD_ONLY,
                originTarget: PROPERTIES.KEYWORD_ONLY,
                urlSource: PROPERTIES.KEYWORD_TEXT,
                urlTarget: PROPERTIES.KEYWORD_TEXT,
                created: { type: "date" },
                expired: { type: "date" },
                description: PROPERTIES.KEYWORD_TEXT,
                verifyFn: PROPERTIES.KEYWORD_ONLY,
                verifyFnOutput: PROPERTIES.KEYWORD_ONLY,
                duration: { type: "integer" },
                extraArgs: { type: "flattened" },
            },
        },
    },
    POLICY_DATA: {
        name: `${config.elastic.prefix}-policy-data`,
        rotating: false,
        settings: SETTINGS_DEFAULT,
        mappings: {
            properties: {
                policyId: PROPERTIES.KEYWORD_ONLY,
                linkId: PROPERTIES.KEYWORD_ONLY,
                vals: { type: "flattened" },
            },
        },
    },
    // old
    // POLICY_STATUS: {
    //     name: `${config.elastic.prefix}-policy-status`,
    //     rotating: true,
    //     settings: SETTINGS_DEFAULT,
    //     mappings: {
    //         properties: {
    //             policyId: PROPERTIES.KEYWORD_ONLY,
    //             status: PROPERTIES.KEYWORD_ONLY,
    //             lastChecked: { type: "date" },
    //         },
    //     },
    // },
    // decisions for policy verifications and their lifespans
    VERIFICATIONS: {
        name: `${config.elastic.prefix}-verifications`,
        rotating: false,
        settings: SETTINGS_DEFAULT,
        mappings: {
            properties: {
                timestamp: { type: "date" },
                expires: { type: "date" },
                policyId: PROPERTIES.KEYWORD_ONLY,
                linkId: PROPERTIES.KEYWORD_ONLY,
                originSource: PROPERTIES.KEYWORD_ONLY,
                originTarget: PROPERTIES.KEYWORD_ONLY,
                urlSource: PROPERTIES.KEYWORD_TEXT,
                urlTarget: PROPERTIES.KEYWORD_TEXT,
                outputExpected: PROPERTIES.KEYWORD_ONLY,
                outputActual: PROPERTIES.KEYWORD_ONLY,
                success: { type: "boolean" },
                error: PROPERTIES.KEYWORD_TEXT,
            },
        },
    },
    CRAWLS: {
        name: `${config.elastic.prefix}-crawls`,
        rotating: true,
        settings: SETTINGS_ALT,
        mappings: {
            properties: {
                domain: PROPERTIES.KEYWORD_ONLY,
                page: PROPERTIES.KEYWORD_ONLY,
                pageError: PROPERTIES.KEYWORD_TEXT,
                requestIdOrder: PROPERTIES.KEYWORD_ONLY,
            },
        },
    },
    // from jscollector
    REQUESTS: {
        name: `${config.elastic.prefix}-requests`,
        rotating: true,
        settings: SETTINGS_FOR_REQUESTS,
        mappings: {
            properties: {
                domain: PROPERTIES.KEYWORD_ONLY,
                page: PROPERTIES.KEYWORD_ONLY,
                requestID: PROPERTIES.KEYWORD_ONLY,
                cdpType: PROPERTIES.KEYWORD_ONLY,
                // source: { type: "binary" },
                // doubleFetchSrc: { type: "binary" },
                // tripleFetchSrc: { type: "binary" },
                // sourceID: PROPERTIES.KEYWORD_ONLY,
                // doubleFetchSrcID: PROPERTIES.KEYWORD_ONLY,
                // tripleFetchSrcID: PROPERTIES.KEYWORD_ONLY,
                // diffDoubleFetch: { type: "boolean" },
                // diffTripleFetch: { type: "boolean" },
                reqParams: {
                    properties: {
                        time: { type: "date" },
                        hasUserGesture: { type: "boolean" },
                        type: PROPERTIES.KEYWORD_ONLY,
                        documentUrl: PROPERTIES.KEYWORD_ONLY,
                        usedSri: { type: "boolean" },
                        sriIntegrity: PROPERTIES.KEYWORD_ONLY,
                        sriMatch: { type: "boolean" },
                        foundNode: { type: "boolean" },
                        originalUrl: PROPERTIES.KEYWORD_ONLY,
                        isExternal: { type: "boolean" },
                        url: PROPERTIES.KEYWORD_ONLY,
                        urlFragment: PROPERTIES.KEYWORD_ONLY,
                        method: PROPERTIES.KEYWORD_ONLY,
                        postData: PROPERTIES.KEYWORD_ONLY,
                        hasPostData: { type: "boolean" },
                        mixedContent: PROPERTIES.KEYWORD_ONLY,
                        initialPriority: PROPERTIES.KEYWORD_ONLY,
                        referrerPolicy: PROPERTIES.KEYWORD_ONLY,
                        linkPreload: { type: "boolean" },
                        failedRetryCount: { type: "integer" },
                        loadFailedError: PROPERTIES.KEYWORD_ONLY,
                        loadFailedCanceled: { type: "boolean" },
                        loadFailedBlocked: PROPERTIES.KEYWORD_ONLY,
                        loadFailedCors: PROPERTIES.KEYWORD_ONLY,
                        initiator: {
                            properties: {
                                initType: PROPERTIES.KEYWORD_ONLY,
                                url: PROPERTIES.KEYWORD_ONLY,
                                lineNumber: { type: "integer" },
                                columnNumber: { type: "integer" },
                                requestId: PROPERTIES.KEYWORD_ONLY,
                                stackDescription: PROPERTIES.KEYWORD_ONLY,
                                stackCallFrameUrls: PROPERTIES.KEYWORD_ONLY,
                            },
                        },
                        headers: { type: "flattened" },
                    },
                },
                respParams: {
                    properties: {
                        url: PROPERTIES.KEYWORD_ONLY,
                        status: { type: "integer" },
                        mimeType: PROPERTIES.KEYWORD_ONLY,
                        // connectionReused: { type: "boolean" },
                        remoteIPAddress: { type: "ip" },
                        remoteIPASN: { type: "long" }, // 32-bit compatibility
                        remoteIPOrg: PROPERTIES.KEYWORD_ONLY,
                        remotePort: { type: "integer" },
                        fromDiskCache: { type: "boolean" },
                        fromServiceWorker: { type: "boolean" },
                        fromPrefetchCache: { type: "boolean" },
                        encodedDataLength: { type: "integer" },
                        serviceWorkerResponseSource: PROPERTIES.KEYWORD_ONLY,
                        time: { type: "date" },
                        cacheStorageCacheName: PROPERTIES.KEYWORD_ONLY,
                        protocol: PROPERTIES.KEYWORD_ONLY,
                        securityState: PROPERTIES.KEYWORD_ONLY,
                        headers: { type: "flattened" },
                    },
                },
                response: {
                    properties: {
                        bodyBinary: { type: "binary" },
                        bodyText: { type: "text", index: false },
                        base64Encoded: { type: "boolean" },
                    }
                }
            },
        },
    },
    // SOURCES: {
    //     name: `${config.elastic.prefix}-sources`,
    //     rotating: true,
    //     settings: SETTINGS_ALT,
    //     mappings: {
    //         properties: {
    //             hash: PROPERTIES.KEYWORD_ONLY, // hashed w/ base64, can't search binary
    //             source: { type: "binary" }, // compressed w/ base64
    //             // source: { type: "binary", index: false }, // compressed w/ base64
    //         },
    //     },
    // },
};


export default {
    INGEST_PIPELINES,
    INDICES,
}