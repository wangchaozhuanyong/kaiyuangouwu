CREATE DATABASE IF NOT EXISTS __TEST_DATABASE__ CHARACTER SET utf8mb4;
USE __TEST_DATABASE__;
CREATE TABLE inventory (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, stock INT NOT NULL, updatedAt DATETIME(6), note VARCHAR(200), amount DECIMAL(20,8), largeNumber BIGINT UNSIGNED, flags BIT(9), payload BLOB, meta JSON, scale DOUBLE, tiny FLOAT, d DATE, t TIME(6), ts TIMESTAMP(6), y YEAR, state ENUM('','a','b'), choices SET('a','b'), fixed BINARY(5), emptyText TEXT, generatedValue INT AS (stock*2) STORED, virtualValue INT AS (stock+1) VIRTUAL);
INSERT INTO inventory (stock,updatedAt,note,amount,largeNumber,flags,payload,meta,scale,tiny,d,t,ts,y,state,choices,fixed,emptyText) VALUES
(100,'2026-09-13 01:02:03.123456',CONVERT(UNHEX('E4B8ADE696870A27225C090000') USING utf8mb4),123456789.12345678,18446744073709551615,b'101010101',UNHEX('000AFF01'),'{"text":"中文","value":123.4}',1.2345678901234567,1.234567,'2026-09-13','-12:34:56.123456','2026-09-13 01:02:03.123456',2026,'a','a,b',UNHEX('0001'),''),
(12,NULL,NULL,-0.00000001,0,b'0',NULL,NULL,-1.23e-35,-1.2e-20,NULL,NULL,NULL,NULL,'','',NULL,NULL);
-- Deleted identifiers must remain allocated after a restore, even though no row contains them.
INSERT INTO inventory (id,stock) VALUES (8000,2);
DELETE FROM inventory WHERE id=8000;
CREATE TABLE orders (id INT PRIMARY KEY AUTO_INCREMENT, qty INT NOT NULL);
CREATE TABLE ledger (id INT PRIMARY KEY AUTO_INCREMENT, orderId INT NOT NULL, qty INT NOT NULL, FOREIGN KEY(orderId) REFERENCES orders(id));
CREATE TABLE no_key (name VARCHAR(200), value DECIMAL(12,4));
INSERT INTO no_key VALUES ('same',12.3456),('same',12.3456),('',0),(NULL,NULL);
CREATE TABLE empty_table (id INT);
CREATE TABLE latin_table (id INT PRIMARY KEY, label VARCHAR(100) CHARACTER SET latin1);
INSERT INTO latin_table VALUES (1,CONVERT(UNHEX('E9') USING latin1));
-- mysqldump can make an inherited column charset explicit when restoring a non-default collation.
CREATE TABLE unicode_table (
    id INT PRIMARY KEY,
    label VARCHAR(100) COLLATE utf8mb4_unicode_ci,
    choices ENUM('a','CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'),
    note TEXT COMMENT 'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
INSERT INTO unicode_table VALUES (1,'中文','a','preserve collation and literal text');
CREATE TABLE trigger_audit (id INT PRIMARY KEY AUTO_INCREMENT, qty INT);
CREATE TRIGGER orders_ai AFTER INSERT ON orders FOR EACH ROW INSERT INTO trigger_audit(qty) VALUES (NEW.qty);
CREATE VIEW stock_view AS SELECT id,stock FROM inventory;
DELIMITER //
CREATE PROCEDURE stored_sample() SELECT stock FROM inventory WHERE id=1//
CREATE EVENT event_sample ON SCHEDULE EVERY 1 DAY DISABLE DO SELECT 1//
DELIMITER ;

UPDATE inventory SET stock=10000 WHERE id=1;
INSERT INTO orders(qty) VALUES(2),(4),(6);
INSERT INTO ledger(orderId,qty) SELECT id,qty FROM orders;
CREATE TABLE bulk_data (id INT PRIMARY KEY, body TEXT);
SET SESSION cte_max_recursion_depth=20001;
INSERT INTO bulk_data WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<20000) SELECT n,REPEAT(SHA2(n,256),16) FROM seq;
