-- Synthetic data only. No production import is supported.
CREATE TABLE channel (id INTEGER, code TEXT);
INSERT INTO channel VALUES (1, 'store-a'), (2, 'store-b');
CREATE TABLE customer (id INTEGER, userId INTEGER);
INSERT INTO customer VALUES (11, 91);
CREATE TABLE customer_channels_channel (customerId INTEGER, channelId INTEGER);
INSERT INTO customer_channels_channel VALUES (11, 1), (11, 2);
CREATE TABLE address (id INTEGER, customerId INTEGER, fullName TEXT, company TEXT, streetLine1 TEXT,
    streetLine2 TEXT, city TEXT, province TEXT, postalCode TEXT, phoneNumber TEXT, countryId INTEGER,
    defaultShippingAddress INTEGER, defaultBillingAddress INTEGER);
INSERT INTO address VALUES (201, 11, 'PRIVATE_PERSON_CANARY', '', 'PRIVATE_ADDRESS_CANARY',
    '', '', '', '00100', 'PRIVATE_PHONE_CANARY', 221, 1, 0);
CREATE TABLE region (id INTEGER, code TEXT, type TEXT);
INSERT INTO region VALUES (221, 'MY', 'country');
CREATE TABLE `order` (id INTEGER, customerId INTEGER, shippingAddress TEXT, billingAddress TEXT);
INSERT INTO `order` VALUES (101, 11, '{"fullName":"PRIVATE_PERSON_CANARY","streetLine1":"PRIVATE_ADDRESS_CANARY","postalCode":"00100","phoneNumber":"PRIVATE_PHONE_CANARY","countryCode":"MY"}', '{}'), (102, 11, '{}', '{}');
CREATE TABLE order_channels_channel (orderId INTEGER, channelId INTEGER);
INSERT INTO order_channels_channel VALUES (101, 1), (102, 2);
CREATE TABLE order_line (id INTEGER, orderId INTEGER, productVariantId INTEGER);
INSERT INTO order_line VALUES (111, 102, 51);
CREATE TABLE product_variant (id INTEGER, sku TEXT, productId INTEGER);
INSERT INTO product_variant VALUES (51, 'SKU', 501);
CREATE TABLE product_variant_channels_channel (productVariantId INTEGER, channelId INTEGER);
INSERT INTO product_variant_channels_channel VALUES (51, 2);
CREATE TABLE stock_location (id INTEGER, name TEXT);
INSERT INTO stock_location VALUES (41, 'warehouse');
CREATE TABLE stock_location_channels_channel (stockLocationId INTEGER, channelId INTEGER);
INSERT INTO stock_location_channels_channel VALUES (41, 1), (41, 2);
CREATE TABLE stock_level (id INTEGER, stockLocationId INTEGER, productVariantId INTEGER, stockOnHand INTEGER, stockAllocated INTEGER);
INSERT INTO stock_level VALUES (401, 41, 51, 7, 2);
CREATE TABLE stock_movement (id INTEGER, stockLocationId INTEGER, productVariantId INTEGER, orderLineId INTEGER, type TEXT, quantity INTEGER);
INSERT INTO stock_movement VALUES (411, 41, 51, 111, 'SALE', -1), (412, 41, 51, NULL, 'ADJUSTMENT', 8);
CREATE TABLE referral_account (id INTEGER, customerId INTEGER, channelId INTEGER, inviteCode TEXT);
INSERT INTO referral_account VALUES (301, 11, 2, 'PRIVATE_INVITE_CANARY');
CREATE TABLE referral_wallet (id INTEGER, customerId INTEGER, channelId INTEGER, referralAccountId INTEGER,
    currencyCode TEXT, availableBalance INTEGER, pendingBalance INTEGER, reservedBalance INTEGER);
INSERT INTO referral_wallet VALUES (311, 11, 2, 301, 'MYR', 5, 0, 0);
CREATE TABLE referral_ledger_entry (id INTEGER, customerId INTEGER, channelId INTEGER, walletId INTEGER,
    currencyCode TEXT, orderId INTEGER, refundId INTEGER, withdrawalId INTEGER, availableDelta INTEGER,
    pendingDelta INTEGER, reservedDelta INTEGER, availableAfter INTEGER, pendingAfter INTEGER, reservedAfter INTEGER);
INSERT INTO referral_ledger_entry VALUES (321, 11, 2, 311, 'MYR', 102, NULL, NULL, 5, 0, 0, 5, 0, 0);
CREATE TABLE referral_relationship (id INTEGER, inviterCustomerId INTEGER, inviteeCustomerId INTEGER, channelId INTEGER);
INSERT INTO referral_relationship VALUES (331, 12, 11, 2);
CREATE TABLE referral_reward (id INTEGER, inviterCustomerId INTEGER, inviteeCustomerId INTEGER, channelId INTEGER,
    orderId INTEGER, currencyCode TEXT, rewardAmount INTEGER, releasedAmount INTEGER, clawedBackAmount INTEGER, status TEXT);
CREATE TABLE referral_balance_use (id INTEGER, customerId INTEGER, channelId INTEGER, walletId INTEGER,
    orderId INTEGER, currencyCode TEXT, amount INTEGER, refundedAmount INTEGER, status TEXT);
CREATE TABLE referral_wallet_usage (id INTEGER, customerId INTEGER, channelId INTEGER, walletId INTEGER,
    currencyCode TEXT, amount INTEGER, capturedAmount INTEGER, releasedAmount INTEGER, status TEXT);
CREATE TABLE referral_withdrawal (id INTEGER, customerId INTEGER, channelId INTEGER, walletId INTEGER, currencyCode TEXT, amount INTEGER, status TEXT);
CREATE TABLE payment_method (id INTEGER, code TEXT, enabled INTEGER, checker TEXT, handler TEXT);
INSERT INTO payment_method VALUES (61, 'offline', 1, NULL, '{"code":"offline","args":[{"name":"apiKey","value":"PRIVATE_PROCESSOR_CANARY"}]}');
CREATE TABLE payment_method_channels_channel (paymentMethodId INTEGER, channelId INTEGER);
INSERT INTO payment_method_channels_channel VALUES (61, 1), (61, 2);
CREATE TABLE payment (id INTEGER, method TEXT, orderId INTEGER);
INSERT INTO payment VALUES (621, 'offline', 102);
CREATE TABLE shipping_method (id INTEGER, code TEXT, checker TEXT, calculator TEXT, fulfillmentHandlerCode TEXT);
INSERT INTO shipping_method VALUES (62, 'delivery', '{"code":"all","args":[]}', '{"code":"free","args":[]}', 'manual');
CREATE TABLE shipping_method_channels_channel (shippingMethodId INTEGER, channelId INTEGER);
INSERT INTO shipping_method_channels_channel VALUES (62, 1), (62, 2);
CREATE TABLE shipping_line (id INTEGER, shippingMethodId INTEGER, orderId INTEGER);
INSERT INTO shipping_line VALUES (631, 62, 102);
CREATE TABLE customer_delivery_email (id INTEGER, customerId INTEGER, channelId INTEGER, isDefault INTEGER, emailAddress TEXT);
INSERT INTO customer_delivery_email VALUES (701, 11, 1, 1, 'PRIVATE_EMAIL_CANARY');
CREATE TABLE after_sales_request (id INTEGER, customerId INTEGER, channelId INTEGER, orderId INTEGER, refundId INTEGER);
INSERT INTO after_sales_request VALUES (702, 11, 1, 101, NULL);
CREATE TABLE customer_coupon (id INTEGER, customerId INTEGER, channelId INTEGER, promotionId INTEGER,
    campaignConfigId INTEGER, lockedOrderId INTEGER, usedOrderId INTEGER, status TEXT);
INSERT INTO customer_coupon VALUES (711, 11, 1, 1, 1, 101, NULL, 'LOCKED');
CREATE TABLE coupon_ledger_entry (id INTEGER, customerId INTEGER, channelId INTEGER, customerCouponId INTEGER,
    promotionId INTEGER, orderId INTEGER, refundId INTEGER, eventType TEXT);
INSERT INTO coupon_ledger_entry VALUES (712, 11, 1, 711, 1, 101, NULL, 'LOCK');
CREATE TABLE coupon_order_allocation (id INTEGER, customerId INTEGER, channelId INTEGER, customerCouponId INTEGER,
    promotionId INTEGER, orderId INTEGER, refundId INTEGER, status TEXT);
INSERT INTO coupon_order_allocation VALUES (713, 11, 1, 711, 1, 101, NULL, 'LOCKED');
CREATE TABLE storefront_daily_visitor (id INTEGER, customerId INTEGER, channelId INTEGER, visitCount INTEGER, visitorKeyHash TEXT);
INSERT INTO storefront_daily_visitor VALUES (721, 11, 1, 3, 'PRIVATE_VISITOR_CANARY');
CREATE TABLE customer_groups_customer_group (customerId INTEGER, customerGroupId INTEGER);
INSERT INTO customer_groups_customer_group VALUES (11, 801);
CREATE TABLE customer_group (id INTEGER);
INSERT INTO customer_group VALUES (801);
CREATE TABLE history_entry (id INTEGER, customerId INTEGER, orderId INTEGER, administratorId INTEGER, type TEXT, isPublic INTEGER, data TEXT);
INSERT INTO history_entry VALUES (731, 11, 101, NULL, 'CUSTOMER_REGISTERED', 0, 'PRIVATE_HISTORY_CANARY');
CREATE TABLE user (id INTEGER, verified INTEGER, deletedAt TEXT, identifier TEXT);
INSERT INTO user VALUES (91, 1, NULL, 'PRIVATE_LOGIN_CANARY');
CREATE TABLE authentication_method (id INTEGER, userId INTEGER, type TEXT, passwordHash TEXT, verificationToken TEXT);
INSERT INTO authentication_method VALUES (741, 91, 'NativeAuthenticationMethod', 'PRIVATE_PASSWORD_CANARY', 'PRIVATE_TOKEN_CANARY');
CREATE TABLE administrator (id INTEGER, userId INTEGER, deletedAt TEXT);
CREATE TABLE session (id INTEGER, userId INTEGER, activeOrderId INTEGER, activeChannelId INTEGER,
    invalidated INTEGER, expires TEXT, authenticationStrategy TEXT, token TEXT);
INSERT INTO session VALUES (751, 91, 101, 1, 0, '2026-09-14', 'native', 'PRIVATE_SESSION_CANARY');
CREATE TABLE api_key (id INTEGER, userId INTEGER, ownerId INTEGER, deletedAt TEXT, apiKeyHash TEXT);
CREATE TABLE api_key_channels_channel (apiKeyId INTEGER, channelId INTEGER);
CREATE TABLE user_roles_role (userId INTEGER, roleId INTEGER);
INSERT INTO user_roles_role VALUES (91, 761);
CREATE TABLE role (id INTEGER, code TEXT, permissions TEXT);
INSERT INTO role VALUES (761, 'customer', 'Authenticated,Owner');
CREATE TABLE role_channels_channel (roleId INTEGER, channelId INTEGER);
INSERT INTO role_channels_channel VALUES (761, 1), (761, 2);
-- Pre-provisioned synthetic destinations; the executor never creates users or copies profiles.
INSERT INTO customer VALUES (12, NULL);
INSERT INTO customer_channels_channel VALUES (12, 2);
INSERT INTO customer VALUES (21, NULL);
INSERT INTO stock_location VALUES (42, 'synthetic-destination');
INSERT INTO address VALUES (202, 11, 'SYNTHETIC_B', '', 'SYNTHETIC_STREET_B', '', '', '', '00200', '', 221, 0, 1);
UPDATE `order` SET billingAddress='{"fullName":"SYNTHETIC_B","streetLine1":"SYNTHETIC_STREET_B","postalCode":"00200","countryCode":"MY"}' WHERE id=102;
ALTER TABLE `order` ADD COLUMN subTotal INTEGER NOT NULL DEFAULT 1200;
ALTER TABLE `order` ADD COLUMN subTotalWithTax INTEGER NOT NULL DEFAULT 1200;
ALTER TABLE `order` ADD COLUMN shipping INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `order` ADD COLUMN shippingWithTax INTEGER NOT NULL DEFAULT 0;
ALTER TABLE `order` ADD COLUMN currencyCode TEXT NOT NULL DEFAULT 'MYR';
INSERT INTO customer_delivery_email VALUES (802, 11, 2, 1, 'synthetic-b@example.invalid');
INSERT INTO after_sales_request VALUES (803, 11, 2, 102, NULL);
INSERT INTO customer_coupon VALUES (811, 11, 2, 2, 2, 102, NULL, 'LOCKED');
INSERT INTO coupon_ledger_entry VALUES (812, 11, 2, 811, 2, 102, NULL, 'LOCK');
INSERT INTO coupon_order_allocation VALUES (813, 11, 2, 811, 2, 102, NULL, 'LOCKED');
INSERT INTO storefront_daily_visitor VALUES (821, 11, 2, 2, 'SYNTHETIC_VISITOR_B');
INSERT INTO history_entry VALUES (832, 11, 102, NULL, 'CUSTOMER_REGISTERED', 0, 'SYNTHETIC_HISTORY_B');
INSERT INTO customer_group VALUES (802);
INSERT INTO customer_groups_customer_group VALUES (11, 802);
INSERT INTO referral_wallet VALUES (312, 11, 2, 301, 'USD', 17, 3, 2);
INSERT INTO referral_ledger_entry VALUES (322, 11, 2, 312, 'USD', 102, NULL, NULL, 17, 3, 2, 17, 3, 2);
UPDATE session SET invalidated=1;
-- Shared iCloud remains byte-for-byte protected by the executor.
CREATE TABLE icloud_primary_account (id INTEGER PRIMARY KEY, label TEXT);
INSERT INTO icloud_primary_account VALUES (1, 'SYNTHETIC_SHARED');
