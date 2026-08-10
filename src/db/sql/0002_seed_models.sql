-- Phase 1 seed: image models only. Video models land in Phase 3 once their
-- current fal slugs are verified. 1 credit ≈ $0.01 of provider spend.

insert into public.models (provider, provider_slug, display_name, modality, params_schema, cost_config, sort_order)
values
  (
    'fal',
    'fal-ai/flux/schnell',
    'Flux Schnell',
    'text_to_image',
    '{"image_size": ["square_hd", "portrait_4_3", "landscape_4_3", "landscape_16_9", "portrait_16_9"], "num_images": {"min": 1, "max": 4}}',
    '{"type": "per_image", "credits": 1}',
    10
  ),
  (
    'fal',
    'fal-ai/flux/dev',
    'Flux Dev',
    'text_to_image',
    '{"image_size": ["square_hd", "portrait_4_3", "landscape_4_3", "landscape_16_9", "portrait_16_9"], "num_images": {"min": 1, "max": 4}}',
    '{"type": "per_image", "credits": 3}',
    20
  )
on conflict (provider_slug) do nothing;
