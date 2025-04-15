const config = require("/home/ubuntu/app/configs/config");
const VerifyWorker = require("/home/ubuntu/app/src/worker").VerifyWorker;

(async () => {
    try {
        const worker = new VerifyWorker(config);
        await worker.init();
    } catch (err) {
        console.error(err);
    }
})();