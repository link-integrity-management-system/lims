const config = require("/home/ubuntu/app/configs/config");

const authenticateKey = (req, res, next) => {
    const apiKey = req.header("x-api-key");
    if (apiKey == config.lms.api_key) {
        next();
    } else {
        res.status(403).send({ error: { code: 403, message: "You do not have permission to access this resource." } });
    }
}

module.exports = { authenticateKey };