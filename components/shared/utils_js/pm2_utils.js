const pm2 = require("pm2");

async function stopPM2Processes(name) {
    const promise = new Promise((resolve, reject) => {
        pm2.stop(name, (err, res) => {
            if (err) {
                reject(err);
            }
            resolve();
        });
    });
    try {
        await promise;
    } catch (err) {
        console.error(`pm2.stop returned error`, err);
    }
}

async function restartPM2Processes(name, opts) {
    const promise = new Promise((resolve, reject) => {
        pm2.restart(name, opts, (err, res) => {
            if (err) {
                reject(err);
            }
            resolve();
        });
    });
    try {
        await promise;
    } catch (err) {
        console.error(`pm2.restart returned error`, err);
    }
}

async function getPM2ProcessIndex(name) {
    let pm2ProcIdx = null;
    const promise = new Promise((resolve, reject) => {
        pm2.describe(name, (err, res) => {
            if (err) {
                reject(err);
            }
            for (const procIdx in res) {
                const proc = res[procIdx];
                if (proc.pid === process.pid) {
                    pm2ProcIdx = procIdx;
                    resolve();
                }
            }
            reject(
                `Current process is not a worker of type '${name}' managed by pm2`
            );
        });
    });
    try {
        await promise;
    } catch (err) {
        pm2ProcIdx = "";
    }
    return pm2ProcIdx;
}

module.exports = {
    stopPM2Processes: stopPM2Processes,
    restartPM2Processes: restartPM2Processes,
    getPM2ProcessIndex: getPM2ProcessIndex,
};
