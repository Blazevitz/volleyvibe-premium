USE afterhours_vbc;

ALTER TABLE event_settings
  ADD COLUMN hero_eyebrow VARCHAR(80) NOT NULL DEFAULT 'AFTER THE LAST WHISTLE' AFTER court_fee,
  ADD COLUMN hero_headline VARCHAR(180) NOT NULL DEFAULT 'Every rally has
a story.' AFTER hero_eyebrow,
  ADD COLUMN hero_description VARCHAR(500) NOT NULL DEFAULT 'A home for the late-night regulars, friendly rivalries, and the points we’ll talk about next week.' AFTER hero_headline,
  ADD COLUMN payment_provider VARCHAR(20) NOT NULL DEFAULT '' AFTER hero_description,
  ADD COLUMN payment_qr_file VARCHAR(80) NULL DEFAULT NULL AFTER payment_provider;
