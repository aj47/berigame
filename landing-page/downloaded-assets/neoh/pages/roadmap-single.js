import Link from "next/link";
import Layout from "../src/layout/Layout";

const RoadmapSingle = () => {
  return (
    <Layout pageName={"Roadmap Single"}>
      <div className="neoh_fn_roadmap neoh_fn_single">
        {/* Single Background */}
        <div className="single_bg" />
        {/* !Single Background */}
        {/* Single Content */}
        <div className="single_content">
          <div className="container" id="roadmap-single-content">
            <div className="neoh_fn_share">
              <h5 className="label">Share:</h5>
              <ul>
                <li>
                  <a href="#">
                    <i className="fn-icon-twitter" />
                  </a>
                </li>
                <li>
                  <a href="#">
                    <i className="fn-icon-facebook" />
                  </a>
                </li>
                <li>
                  <a href="#">
                    <i className="fn-icon-instagram" />
                  </a>
                </li>
                <li>
                  <a href="#">
                    <i className="fn-icon-pinterest" />
                  </a>
                </li>
                <li>
                  <a href="#">
                    <i className="fn-icon-behance" />
                  </a>
                </li>
              </ul>
            </div>
            <div className="neoh_fn_breadcrumbs">
              <p>
                <Link href="/index">Home</Link>
                <span className="separator">/</span>
                <Link href="/roadmap">RoadMap</Link>
                <span className="separator">/</span>
                <span className="current">Mini Game Lounch for Community</span>
              </p>
            </div>
            <div className="single_img">
              <img src="img/blog/single.jpg" alt="" />
            </div>
            {/* Mini Items  */}
            <div className="neoh_fn_minis">
              <div className="m_item">
                <a href="#">June 01, 2022</a>
              </div>
              <div className="m_item">
                <span>
                  By <a href="#">Admin</a>
                </span>
              </div>
            </div>
            {/* !Mini Items  */}
            {/* Single Title */}
            <div className="single_title">
              <h2 className="fn_title">
                Neoh’s NFT Goes Public In Nod To Crypto Adoption
              </h2>
              <div className="categories">
                <a href="#">Tokens</a>, <a href="#">NFTs</a>,{" "}
                <a href="#">Crypto</a>
              </div>
            </div>
            {/* !Single Title */}
            {/* Single Description */}
            <div className="single_desc">
              <p>
                Suspendisse eu velit est. Cras nec vestibulum quam. Donec
                tincidunt purus nec enim tincidunt, sit amet facilisis massa
                laoreet. Integer mollis nec sapien eu lacinia. Nunc eu massa
                dictum, vulputate neque ac, porta mauris. Sed sollicitudin nisi
                augue, a gravida turpis elementum vel. Curabitur sagittis quis
                diam et rhoncus. Nam pellentesque imperdiet aliquet. Sed non
                ante malesuada, ultrices sem at, tempus libero.
              </p>
              <p>
                Duis eu lorem ut mauris pulvinar auctor. Maecenas et dapibus
                orci, eleifend euismod justo. Quisque luctus turpis eu tristique
                feugiat. Praesent ac magna feugiat, interdum lacus ac, interdum
                dui. Pellentesque id quam quis enim malesuada rutrum. Orci
                varius natoque penatibus et magnis dis parturient montes,
                nascetur ridiculus mus. Nulla vel neque et ex vestibulum
                elementum at sed lacus. Fusce imperdiet mauris ac mi viverra
                viverra. Maecenas pharetra nibh non arcu finibus, vel ultrices
                arcu porttitor. Quisque ac nisl id lectus faucibus pulvinar nec
                ut nisl. Duis ultricies ut lacus sed rutrum.
              </p>
              <p>
                Duis eu lorem ut mauris pulvinar auctor. Maecenas et dapibus
                orci, eleifend euismod justo. Quisque luctus turpis eu tristique
                feugiat. Praesent ac magna feugiat, interdum lacus ac, interdum
                dui. Pellentesque id quam quis enim malesuada rutrum. Orci
                varius natoque penatibus et magnis dis parturient montes,
                nascetur ridiculus mus. Nulla vel neque et ex vestibulum
                elementum at sed lacus. Fusce imperdiet mauris ac mi viverra
                viverra. Maecenas pharetra nibh non arcu finibus, vel ultrices
                arcu porttitor. Quisque ac nisl id lectus faucibus pulvinar nec
                ut nisl. Duis ultricies ut lacus sed rutrum.
              </p>
              <p>
                Suspendisse dignissim ultricies iaculis. Suspendisse ultrices
                turpis mi, non tincidunt orci interdum tempor. Praesent
                venenatis, lorem egestas consequat tempor, nunc neque venenatis
                risus, vitae interdum ipsum ipsum eget purus. Proin ac leo non
                est imperdiet commodo. Donec dictum augue ut odio feugiat
                vulputate. Pellentesque ultricies augue in posuere ornare.
                Pellentesque pretium non nunc ac sodales.
              </p>
              <p>
                Nam et malesuada ante, in convallis libero. Aenean sollicitudin
                egestas ante, eget porttitor leo fringilla sit amet. Nam cursus
                neque ligula, in egestas elit porttitor vel. Vestibulum
                ultricies tempus orci a auctor. Curabitur sed pretium lacus,
                eget cursus dui. Aliquam at ex sit amet urna interdum dignissim
                vel non dolor. Pellentesque mi nibh, sollicitudin at neque id,
                tincidunt molestie lorem. Nulla facilisi. Phasellus viverra mi
                ut sapien efficitur, sit amet suscipit lorem commodo. Interdum
                et malesuada fames ac ante ipsum primis in faucibus.
              </p>
            </div>
            {/* !Single Description */}
            {/* Mosaic Gallery */}
            <div className="neoh_fn_mosaic">
              <ul>
                <li>
                  <div className="item" data-bg-img="img/drops/1.jpg">
                    <img src="img/thumbs/1-1.jpg" alt="" />
                  </div>
                </li>
                <li>
                  <div className="item" data-bg-img="img/drops/2.jpg">
                    <img src="img/thumbs/1-1.jpg" alt="" />
                  </div>
                </li>
                <li>
                  <div className="item" data-bg-img="img/drops/3.jpg">
                    <img src="img/thumbs/1-1.jpg" alt="" />
                  </div>
                </li>
                <li>
                  <div className="item" data-bg-img="img/drops/4.jpg">
                    <img src="img/thumbs/1-1.jpg" alt="" />
                  </div>
                </li>
                <li>
                  <div className="item" data-bg-img="img/drops/5.jpg">
                    <img src="img/thumbs/1-1.jpg" alt="" />
                  </div>
                </li>
                <li>
                  <div className="item" data-bg-img="img/drops/6.jpg">
                    <img src="img/thumbs/1-1.jpg" alt="" />
                  </div>
                </li>
                <li>
                  <div className="item" data-bg-img="img/drops/7.jpg">
                    <img src="img/thumbs/1-1.jpg" alt="" />
                  </div>
                </li>
                <li>
                  <div className="item" data-bg-img="img/drops/8.jpg">
                    <img src="img/thumbs/1-1.jpg" alt="" />
                  </div>
                </li>
                <li>
                  <div className="item" data-bg-img="img/drops/9.jpg">
                    <img src="img/thumbs/1-1.jpg" alt="" />
                  </div>
                </li>
              </ul>
            </div>
            {/* !Mosaic Gallery */}
            {/* Single Description */}
            <div className="single_desc">
              <p>
                Suspendisse eu velit est. Cras nec vestibulum quam. Donec
                tincidunt purus nec enim tincidunt, sit amet facilisis massa
                laoreet. Integer mollis nec sapien eu lacinia. Nunc eu massa
                dictum, vulputate neque ac, porta mauris. Sed sollicitudin nisi
                augue, a gravida turpis elementum vel. Curabitur sagittis quis
                diam et rhoncus. Nam pellentesque imperdiet aliquet. Sed non
                ante malesuada, ultrices sem at, tempus libero.
              </p>
              <p>
                Duis eu lorem ut mauris pulvinar auctor. Maecenas et dapibus
                orci, eleifend euismod justo. Quisque luctus turpis eu tristique
                feugiat. Praesent ac magna feugiat, interdum lacus ac, interdum
                dui. Pellentesque id quam quis enim malesuada rutrum. Orci
                varius natoque penatibus et magnis dis parturient montes,
                nascetur ridiculus mus. Nulla vel neque et ex vestibulum
                elementum at sed lacus. Fusce imperdiet mauris ac mi viverra
                viverra. Maecenas pharetra nibh non arcu finibus, vel ultrices
                arcu porttitor. Quisque ac nisl id lectus faucibus pulvinar nec
                ut nisl. Duis ultricies ut lacus sed rutrum.
              </p>
              <p>
                Duis eu lorem ut mauris pulvinar auctor. Maecenas et dapibus
                orci, eleifend euismod justo. Quisque luctus turpis eu tristique
                feugiat. Praesent ac magna feugiat, interdum lacus ac, interdum
                dui. Pellentesque id quam quis enim malesuada rutrum. Orci
                varius natoque penatibus et magnis dis parturient montes,
                nascetur ridiculus mus. Nulla vel neque et ex vestibulum
                elementum at sed lacus. Fusce imperdiet mauris ac mi viverra
                viverra. Maecenas pharetra nibh non arcu finibus, vel ultrices
                arcu porttitor. Quisque ac nisl id lectus faucibus pulvinar nec
                ut nisl. Duis ultricies ut lacus sed rutrum.
              </p>
              <p>
                Suspendisse dignissim ultricies iaculis. Suspendisse ultrices
                turpis mi, non tincidunt orci interdum tempor. Praesent
                venenatis, lorem egestas consequat tempor, nunc neque venenatis
                risus, vitae interdum ipsum ipsum eget purus. Proin ac leo non
                est imperdiet commodo. Donec dictum augue ut odio feugiat
                vulputate. Pellentesque ultricies augue in posuere ornare.
                Pellentesque pretium non nunc ac sodales.
              </p>
              <p>
                Nam et malesuada ante, in convallis libero. Aenean sollicitudin
                egestas ante, eget porttitor leo fringilla sit amet. Nam cursus
                neque ligula, in egestas elit porttitor vel. Vestibulum
                ultricies tempus orci a auctor. Curabitur sed pretium lacus,
                eget cursus dui. Aliquam at ex sit amet urna interdum dignissim
                vel non dolor. Pellentesque mi nibh, sollicitudin at neque id,
                tincidunt molestie lorem. Nulla facilisi. Phasellus viverra mi
                ut sapien efficitur, sit amet suscipit lorem commodo. Interdum
                et malesuada fames ac ante ipsum primis in faucibus.
              </p>
            </div>
            {/* !Single Description */}
          </div>
          {/* Video Section */}
          <section id="video">
            {/* Dividers */}
            <img
              src="svg/divider.svg"
              alt=""
              className="fn__svg fn__divider top_divider"
            />
            <img
              src="svg/divider.svg"
              alt=""
              className="fn__svg fn__divider bottom_divider"
            />
            {/* !Dividers */}
            {/* Video Shortcode */}
            <div className="neoh_fn_video">
              <div className="bg_overlay">
                <div className="bg_image" data-bg-img="img/hero/bg.jpg" />
                <div className="bg_color" />
              </div>
              <div className="v_content">
                <a
                  className="popup-youtube"
                  href="//www.youtube.com/embed/7e90gBu4pas?autoplay=1"
                >
                  <img src="svg/play.svg" alt="" className="fn__svg" />
                </a>
              </div>
            </div>
            {/* !Video Shortcode */}
          </section>
          {/* !Video Section */}
          {/* Single Description */}
          <div className="single_desc" id="roadmap-desc">
            <div className="container">
              <p>
                Suspendisse eu velit est. Cras nec vestibulum quam. Donec
                tincidunt purus nec enim tincidunt, sit amet facilisis massa
                laoreet. Integer mollis nec sapien eu lacinia. Nunc eu massa
                dictum, vulputate neque ac, porta mauris. Sed sollicitudin nisi
                augue, a gravida turpis elementum vel. Curabitur sagittis quis
                diam et rhoncus. Nam pellentesque imperdiet aliquet. Sed non
                ante malesuada, ultrices sem at, tempus libero.
              </p>
              <p>
                Duis eu lorem ut mauris pulvinar auctor. Maecenas et dapibus
                orci, eleifend euismod justo. Quisque luctus turpis eu tristique
                feugiat. Praesent ac magna feugiat, interdum lacus ac, interdum
                dui. Pellentesque id quam quis enim malesuada rutrum. Orci
                varius natoque penatibus et magnis dis parturient montes,
                nascetur ridiculus mus. Nulla vel neque et ex vestibulum
                elementum at sed lacus. Fusce imperdiet mauris ac mi viverra
                viverra. Maecenas pharetra nibh non arcu finibus, vel ultrices
                arcu porttitor. Quisque ac nisl id lectus faucibus pulvinar nec
                ut nisl. Duis ultricies ut lacus sed rutrum.
              </p>
            </div>
          </div>
          {/* !Single Description */}
        </div>
        {/* !Single Content */}
      </div>
    </Layout>
  );
};
export default RoadmapSingle;
