-- Video models + camera-motion presets (Phase 3). Idempotent.

insert into models (provider, provider_slug, display_name, modality, params_schema, cost_config, sort_order)
values
  (
    'fal', 'fal-ai/kling-video/v2.1/standard/image-to-video', 'Kling 2.1 Standard',
    'image_to_video',
    '{"duration": {"enum": ["5", "10"], "default": "5"}}',
    '{"type": "per_second", "credits": 5}', 100
  ),
  (
    'fal', 'fal-ai/wan/v2.2-5b/image-to-video', 'Wan 2.2 (fast)',
    'image_to_video',
    '{"resolution": {"enum": ["580p", "720p"], "default": "720p"}}',
    '{"type": "flat", "credits": 8}', 110
  ),
  (
    'fal', 'fal-ai/wan/v2.2-5b/text-to-video', 'Wan 2.2 (fast)',
    'text_to_video',
    '{"resolution": {"enum": ["580p", "720p"], "default": "720p"}, "aspect_ratio": {"enum": ["16:9", "9:16", "1:1"], "default": "16:9"}}',
    '{"type": "flat", "credits": 8}', 120
  )
on conflict (provider_slug) do update set
  display_name = excluded.display_name,
  modality = excluded.modality,
  params_schema = excluded.params_schema,
  cost_config = excluded.cost_config,
  sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- Camera-motion presets (image_to_video on Kling standard). {subject} is the
-- user's short description of the scene in the source image.
-- ---------------------------------------------------------------------------
with m as (
  select id from models where provider_slug = 'fal-ai/kling-video/v2.1/standard/image-to-video'
)
insert into presets
  (slug, name, category, modality, model_id, prompt_template, negative_prompt, params, sort_order)
values
  (
    'crash-zoom', 'Crash Zoom', 'camera', 'image_to_video', (select id from m),
    '{subject}, rapid crash zoom toward the subject, aggressive push-in, subtle motion blur at the edges, high-energy cinematic move',
    'blur, distort, low quality, warping', '{"duration": "5"}', 200
  ),
  (
    'bullet-time', 'Bullet Time', 'camera', 'image_to_video', (select id from m),
    '{subject}, bullet time effect, camera orbits around the frozen subject, time nearly stopped, sweeping arc move, matrix style',
    'blur, distort, low quality, warping', '{"duration": "5"}', 210
  ),
  (
    'dolly-in', 'Dolly In', 'camera', 'image_to_video', (select id from m),
    '{subject}, slow smooth dolly in, steady push toward the subject, shallow depth of field, contemplative cinematic pace',
    'blur, distort, low quality, shaky', '{"duration": "5"}', 220
  ),
  (
    'dolly-out-reveal', 'Dolly Out Reveal', 'camera', 'image_to_video', (select id from m),
    '{subject}, slow dolly out revealing the wider scene, expanding frame, environment unfolds around the subject, cinematic reveal',
    'blur, distort, low quality, shaky', '{"duration": "5"}', 230
  ),
  (
    'fpv-drone', 'FPV Drone', 'camera', 'image_to_video', (select id from m),
    '{subject}, FPV drone shot weaving through the scene, fast fluid flight path, dynamic banking turns, adrenaline racing footage',
    'blur, distort, low quality, static camera', '{"duration": "5"}', 240
  ),
  (
    'orbit-360', '360 Orbit', 'camera', 'image_to_video', (select id from m),
    '{subject}, smooth 360 degree orbit around the subject, constant radius, subject centered, showcase rotation',
    'blur, distort, low quality, warping', '{"duration": "5"}', 250
  ),
  (
    'earth-zoom-out', 'Earth Zoom Out', 'vfx', 'image_to_video', (select id from m),
    '{subject}, dramatic zoom out from the subject rising into the sky, ground shrinking below, clouds rushing past, satellite view finale',
    'blur, distort, low quality', '{"duration": "5"}', 260
  ),
  (
    'handheld-doc', 'Handheld Doc', 'camera', 'image_to_video', (select id from m),
    '{subject}, handheld documentary camera, subtle natural shake, slight drift and refocus, intimate observational feel',
    'blur, distort, low quality, smooth gimbal', '{"duration": "5"}', 270
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
