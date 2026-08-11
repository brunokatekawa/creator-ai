-- More text-to-image models: GPT Image 2, Nano Banana, Seedream 4.
--
-- Pricing verified against fal.ai docs (2026-08-11):
--   nano-banana        flat $0.039/image                    -> 4 credits
--   seedream/v4         flat $0.03/image                     -> 3 credits
--   gpt-image-2         quality x size grid, $0.037-$0.056    -> 8 credits
--                        at "medium" quality (the only tier we allow — see
--                        fal.ts, which force-sets quality server-side so a
--                        tampered request can never reach the $0.21 "high"
--                        tier while we bill for "medium").
--
-- image_size/aspect_ratio choice lists use the plain-array shape already
-- established by the flux rows; the /api/generate sanitizer treats any
-- array-valued schema entry as an enum whitelist.
insert into models (provider, provider_slug, display_name, modality, params_schema, cost_config, sort_order)
values
  (
    'fal', 'fal-ai/nano-banana', 'Nano Banana', 'text_to_image',
    '{"aspect_ratio": ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9"], "num_images": {"min": 1, "max": 4}}',
    '{"type": "per_image", "credits": 4}', 30
  ),
  (
    'fal', 'fal-ai/bytedance/seedream/v4/text-to-image', 'Seedream 4', 'text_to_image',
    '{"image_size": ["square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"], "num_images": {"min": 1, "max": 4}}',
    '{"type": "per_image", "credits": 3}', 40
  ),
  (
    'fal', 'openai/gpt-image-2', 'GPT Image 2', 'text_to_image',
    '{"image_size": ["square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"], "num_images": {"min": 1, "max": 4}}',
    '{"type": "per_image", "credits": 8}', 50
  )
on conflict (provider_slug) do update set
  display_name = excluded.display_name,
  modality = excluded.modality,
  params_schema = excluded.params_schema,
  cost_config = excluded.cost_config,
  sort_order = excluded.sort_order;
