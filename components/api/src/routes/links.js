const express = require("express");
const router = express.Router();

const service = require("../services/links.service");

router.get("/statuses", service.get_statuses);
router.get("/status", service.get_status);
router.post("/resolutions", service.post_dns_resolutions);

module.exports = router;
