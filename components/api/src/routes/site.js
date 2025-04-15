const express = require("express");
const router = express.Router();

const service = require("../services/site.service");

router.post("/register", service.post_register);
router.post("/crawl", service.post_crawl);
router.post("/verify", service.post_verify);

module.exports = router;
