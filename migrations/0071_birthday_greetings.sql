-- Written by hand, not generated.
--
-- 生日祝福邮件 (shared/http.mjs, birthdayGreetings): on a member's birthday the
-- daily job emails them a greeting with the birthday offer. One row per member
-- per year, claimed before the mail goes out, so a second run or a second
-- Worker isolate never sends it twice; a failed send gives the claim back.
-- IF NOT EXISTS, because 0001 (generated from the Node schema) already has it.
CREATE TABLE IF NOT EXISTS birthday_greetings (
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      sent_at TEXT NOT NULL,
      PRIMARY KEY (customer_id, year)
    );
