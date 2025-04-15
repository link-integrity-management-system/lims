const express = require("express");
const router = express.Router();

const service = require("../services/policies.service");

router.post("/create", service.post_create);

module.exports = router;
