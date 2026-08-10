-- Style presets for the image studio + Realtime publication for job updates.
-- Idempotent: presets upsert on slug; publication add is guarded.

-- ---------------------------------------------------------------------------
-- Realtime: let the studio subscribe to the user's own generation updates.
-- postgres_changes respects RLS, so users only ever see their own rows.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'generations'
  ) then
    alter publication supabase_realtime add table public.generations;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Style presets (text_to_image). {subject} is replaced with the user prompt.
-- flux/dev for looks that need fidelity; schnell for graphic/flat styles.
-- ---------------------------------------------------------------------------
with m as (
  select id, provider_slug from models
  where provider_slug in ('fal-ai/flux/dev', 'fal-ai/flux/schnell')
)
insert into presets
  (slug, name, category, modality, model_id, prompt_template, negative_prompt, params, sort_order)
values
  (
    'cinematic',
    'Cinematic',
    'style', 'text_to_image',
    (select id from m where provider_slug = 'fal-ai/flux/dev'),
    '{subject}, cinematic still, anamorphic lens, shallow depth of field, film grain, moody color grade, 2.39:1 letterbox feel',
    'cartoon, illustration, low quality, watermark',
    '{"image_size": "landscape_16_9"}', 10
  ),
  (
    'editorial-portrait',
    'Editorial Portrait',
    'style', 'text_to_image',
    (select id from m where provider_slug = 'fal-ai/flux/dev'),
    'editorial portrait of {subject}, fashion magazine cover, studio strobe lighting, medium format look, sharp eyes, neutral seamless backdrop',
    'snapshot, cluttered background, low quality',
    '{"image_size": "portrait_4_3"}', 20
  ),
  (
    'film-noir',
    'Film Noir',
    'style', 'text_to_image',
    (select id from m where provider_slug = 'fal-ai/flux/dev'),
    '{subject}, film noir, high-contrast black and white, hard shadows, venetian blind light, 1940s atmosphere, cigarette smoke haze',
    'color, flat lighting',
    '{"image_size": "portrait_4_3"}', 30
  ),
  (
    'golden-hour',
    'Golden Hour',
    'style', 'text_to_image',
    (select id from m where provider_slug = 'fal-ai/flux/dev'),
    '{subject}, golden hour sunlight, warm rim light, lens flare, soft haze, backlit, rich amber tones',
    'overcast, flat light, low quality',
    '{"image_size": "landscape_4_3"}', 40
  ),
  (
    'cyberpunk-neon',
    'Cyberpunk Neon',
    'style', 'text_to_image',
    (select id from m where provider_slug = 'fal-ai/flux/dev'),
    '{subject}, cyberpunk city night, neon signs, wet asphalt reflections, teal and magenta palette, volumetric fog, blade runner atmosphere',
    'daylight, rural, low quality',
    '{"image_size": "landscape_16_9"}', 50
  ),
  (
    'anime',
    'Anime',
    'style', 'text_to_image',
    (select id from m where provider_slug = 'fal-ai/flux/dev'),
    '{subject}, anime key visual, cel shading, vibrant colors, detailed background art, studio quality anime film still',
    'photorealistic, 3d render, low quality',
    '{"image_size": "landscape_16_9"}', 60
  ),
  (
    'watercolor',
    'Watercolor',
    'style', 'text_to_image',
    (select id from m where provider_slug = 'fal-ai/flux/schnell'),
    '{subject}, loose watercolor painting, wet-on-wet washes, visible paper texture, soft color bleeding, minimal linework',
    'photo, sharp edges, digital look',
    '{"image_size": "square_hd"}', 70
  ),
  (
    'product-shot',
    'Product Shot',
    'style', 'text_to_image',
    (select id from m where provider_slug = 'fal-ai/flux/dev'),
    'commercial product photography of {subject}, seamless gradient backdrop, softbox reflections, ultra sharp, advertising quality, centered composition',
    'clutter, hands, low quality, watermark',
    '{"image_size": "square_hd"}', 80
  ),
  (
    'isometric-3d',
    'Isometric 3D',
    'style', 'text_to_image',
    (select id from m where provider_slug = 'fal-ai/flux/schnell'),
    '{subject}, isometric 3d diorama, clay render style, soft studio lighting, pastel palette, miniature scale, clean background',
    'photo, realistic, flat 2d',
    '{"image_size": "square_hd"}', 90
  ),
  (
    'pixel-art',
    'Pixel Art',
    'style', 'text_to_image',
    (select id from m where provider_slug = 'fal-ai/flux/schnell'),
    '{subject}, 16-bit pixel art, limited retro palette, crisp dithering, video game sprite aesthetic',
    'photo, smooth gradients, 3d',
    '{"image_size": "square"}', 100
  )
on conflict (slug) do update set
  name = excluded.name,
  category = excluded.category,
  modality = excluded.modality,
  model_id = excluded.model_id,
  prompt_template = excluded.prompt_template,
  negative_prompt = excluded.negative_prompt,
  params = excluded.params,
  sort_order = excluded.sort_order;
