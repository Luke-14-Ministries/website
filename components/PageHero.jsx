// Two kinds of page header, because the ministry has two kinds of image.
//
//   photo (default) — a PHOTOGRAPH used as a background. Cropped to fill,
//                     darkened, with the page title set over it. Cropping a
//                     photo is fine: there is no wrong part to lose.
//
//   banner          — a DESIGNED GRAPHIC that already contains its own title,
//                     dates and location as pixels. Cropping one of these cuts
//                     the words off, which is exactly what was happening on
//                     the Adult Adventure Retreat page: a 16:9 artwork forced
//                     into a 3.4:1 band showed only the middle, losing "CAMP
//                     CELEBRATE" along the top and the dates along the bottom.
//                     A banner is rendered at its own aspect ratio, full
//                     width, with no dark overlay and no second title printed
//                     over the one already in the artwork.
//
// The title is still passed for a banner and still rendered — as screen
// reader-only text. Otherwise those words exist only as pixels, which is no
// use to someone using a screen reader and no use to a search engine either.

export default function PageHero({ image, title, subtitle, children, variant = 'photo' }) {
  if (variant === 'banner') {
    return (
      <section className="bg-neutral-900">
        <h1 className="sr-only">{title}</h1>
        {image && (
          // A plain img rather than next/image: these banners are already
          // sized for the web, and this keeps the whole artwork visible at
          // every width without per-image layout config.
          <img src={image} alt={title} className="block w-full h-auto" />
        )}
        {(subtitle || children) && (
          <div className="container-site py-6 text-center text-white">
            {subtitle && <p className="text-xl sm:text-2xl">{subtitle}</p>}
            {children}
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      className="relative flex items-center justify-center text-center text-white min-h-[320px] sm:min-h-[420px] bg-neutral-700 bg-cover bg-center"
      style={image ? { backgroundImage: `url(${image})` } : undefined}
    >
      <div className="absolute inset-0 bg-black/45" />
      <div className="relative container-site py-16">
        <h1 className="text-4xl sm:text-5xl font-bold drop-shadow">{title}</h1>
        {subtitle && (
          <p className="mt-4 text-xl sm:text-2xl drop-shadow">{subtitle}</p>
        )}
        {children}
      </div>
    </section>
  );
}
