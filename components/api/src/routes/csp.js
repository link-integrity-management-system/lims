const express = require("express");
const router = express.Router();

const service = require("../services/csp.service");

router.post("/report", service.post_report);

module.exports = router;
