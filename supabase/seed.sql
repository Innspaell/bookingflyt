-- Startdata: de to bedriftene og et første produktutvalg.
-- Kjøres etter 0001_init.sql. Rediger fritt – produktene kan endres i appen etterpå.

insert into organizations (slug, name, domain, brand_color, widget_heading, widget_intro, allowed_origins)
values
  ('innspaell', 'InnSpæll', 'innspaell.no', '#2f5d50',
   'Fortell oss hva du planlegger', 'Film og foto til bryllup, bedrift og arrangement.',
   array['https://innspaell.no', 'https://www.innspaell.no']),
  ('kjsn', 'Kjøsen Værsågod', 'kjsn.no', '#8a4b2a',
   'Book en innholdsdag', 'Foto, video og innhold til sosiale medier.',
   array['https://kjsn.no', 'https://www.kjsn.no']);

insert into products (org_id, category, name, booking_type, price_ex_vat, sort_order)
select o.id, p.category, p.name, p.booking_type::booking_type, p.price, p.sort
from organizations o
join (values
  ('innspaell', 'Film',         'Bryllupsfilm',                    'heldag',  32000, 1),
  ('innspaell', 'Film',         'Reklamefilm',                     'avtales', 18000, 2),
  ('innspaell', 'Film',         'Eventfilm / aftermovie',          'avtales', 14000, 3),
  ('innspaell', 'Film',         'Konsert- og forestillingsopptak', 'avtales', 12000, 4),
  ('innspaell', 'Film',         'Portrett- og dokumentarfilm',     'avtales', 25000, 5),
  ('innspaell', 'Foto',         'Bryllupsfoto',                    'heldag',  28000, 1),
  ('innspaell', 'Foto',         'Portrett',                        'avtales',  2500, 2),
  ('innspaell', 'Foto',         'Bedriftsportretter',              'avtales',  6500, 3),
  ('innspaell', 'Foto',         'Produktfoto',                     'avtales',  7500, 4),
  ('innspaell', 'Foto',         'Eventfoto',                       'avtales',  6000, 5),
  ('innspaell', 'Foto + video', 'Bryllup foto + film',             'heldag',  55000, 1),
  ('innspaell', 'Foto + video', 'Bedriftspakke foto + video',      'avtales', 24000, 2),
  ('innspaell', 'Foto + video', 'Innhold til sosiale medier',      'avtales',  9000, 3),
  ('kjsn',      'Foto + video', 'Innholdsdag',                     'heldag',  15000, 1),
  ('kjsn',      'Foto + video', 'Kampanjeproduksjon',              'avtales', 22000, 2),
  ('kjsn',      'Film',         'Kortvideo til Reels / TikTok',    'avtales',  7000, 1),
  ('kjsn',      'Foto',         'Produktfoto til nettbutikk',      'avtales',  5500, 1)
) as p(org, category, name, booking_type, price, sort) on p.org = o.slug;

-- Gi deg selv tilgang (kjør ETTER at du har logget inn i appen første gang):
--   insert into members (org_id, user_id, role)
--   select o.id, u.id, 'eier' from organizations o, auth.users u
--   where u.email = 'DIN@EPOST.NO';
