import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const token    = searchParams.get("token") || cookies().get("meta_token")?.value;
  const adIdsRaw = searchParams.get("ad_ids") || "";

  if (!token) return NextResponse.json({ success: false, error: "Not connected to Meta" }, { status: 401 });

  const adIds = adIdsRaw.split(",").map(s => s.trim()).filter(Boolean);
  if (!adIds.length) return NextResponse.json({ success: false, error: "ad_ids is required" }, { status: 400 });

  const fields = "id,name,creative{id,name,thumbnail_url,image_url,video_id,object_story_spec}";

  const results = await Promise.allSettled(
    adIds.map(async (adId) => {
      const url  = `https://graph.facebook.com/v19.0/${adId}?fields=${fields}&access_token=${token}`;
      const res  = await fetch(url, { cache: "no-store" });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);

      const creative = data.creative || {};
      let mediaType = "unknown", thumbnailUrl = null, imageUrl = null, videoId = null;

      if (creative.video_id) {
        mediaType = "video"; videoId = creative.video_id; thumbnailUrl = creative.thumbnail_url || null;
      } else if (creative.thumbnail_url || creative.image_url) {
        mediaType = "image"; thumbnailUrl = creative.thumbnail_url || null; imageUrl = creative.image_url || null;
      }

      if (mediaType === "unknown" && creative.object_story_spec) {
        const spec = creative.object_story_spec;
        if (spec.video_data?.video_id) {
          mediaType = "video"; videoId = spec.video_data.video_id; thumbnailUrl = spec.video_data.image_url || null;
        } else if (spec.link_data?.picture) {
          mediaType = "image"; thumbnailUrl = spec.link_data.picture || null;
        }
      }

      return { ad_id: adId, ad_name: data.name || "", creative_id: creative.id || null,
               creative_name: creative.name || null, media_type: mediaType,
               thumbnail_url: thumbnailUrl, image_url: imageUrl, video_id: videoId };
    })
  );

  return NextResponse.json({ success: true, data: results.filter(r => r.status === "fulfilled").map(r => r.value) });
}
