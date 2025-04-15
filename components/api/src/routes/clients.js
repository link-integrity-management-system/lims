const express = require("express");
const router = express.Router();

const service = require("../services/clients.service");
const { authenticateKey } = require("../utils/auth");

router.get("/", service.get_clients);
router.post("/register", service.post_register);
router.post("/notify", authenticateKey);
router.post("/notify", service.post_notify);
router.get("/vapidPublicKey", service.get_vapidPublicKey);

module.exports = router;
