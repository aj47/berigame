import { Autoplay, EffectCreative } from "swiper";
import { Swiper, SwiperSlide } from "swiper/react";
import AboutComponent from "../src/components/AboutComponent";
import BlogComponent from "../src/components/BlogComponent";
import Drops from "../src/components/Drops";
import ServicesComponent from "../src/components/ServicesComponent";
import WhyChooseUsComponent from "../src/components/WhyChooseUsComponent";
import Layout from "../src/layout/Layout";

const HalfSlider = () => {
  return (
    <Layout pageName={"Home Half Slider"}>
      <div className="neoh_fn_hero half">
        {/* Overlay (of hero header) */}
        <div className="bg_overlay">
          {/* Overlay Slider */}
          <div className="overlay_slider">
            <Swiper
              loop={true}
              effect={"creative"}
              autoplay={{
                delay: 5000,
                disableOnInteraction: false,
              }}
              creativeEffect={{
                prev: {
                  shadow: true,
                  translate: ["-20%", 0, -1],
                },
                next: {
                  translate: ["100%", 0, 0],
                },
              }}
              modules={[EffectCreative, Autoplay]}
              className="swiper-container"
            >
              <div className="swiper-wrapper">
                <SwiperSlide className="swiper-slide">
                  <div className="main_image" data-bg-img="img/drops/1.jpg" />
                </SwiperSlide>
                <SwiperSlide className="swiper-slide">
                  <div className="main_image" data-bg-img="img/drops/2.jpg" />
                </SwiperSlide>
                <SwiperSlide className="swiper-slide">
                  <div className="main_image" data-bg-img="img/drops/3.jpg" />
                </SwiperSlide>
                <SwiperSlide className="swiper-slide">
                  <div className="main_image" data-bg-img="img/drops/4.jpg" />
                </SwiperSlide>
                <SwiperSlide className="swiper-slide">
                  <div className="main_image" data-bg-img="img/drops/5.jpg" />
                </SwiperSlide>
              </div>
            </Swiper>
          </div>
          {/* !Overlay Slider */}
        </div>
        {/* Overlay (of hero header) */}
        <div className="hero_content">
          <div className="container">
            <div className="content">
              <h2 className="fn_title" title="Neoh">
                Neoh
              </h2>
              <p className="fn_desc fn_animated_text">
                The collection built by and runby ‘codeefly’. Together we are
                strong than ever.
              </p>
            </div>
          </div>
          <a
            href="#about"
            className="neoh_fn_down magic-hover magic-hover__square"
          >
            <span className="text">Scroll Down</span>
            <span className="icon">
              <img src="svg/right-arr.svg" alt="" className="fn__svg" />
            </span>
          </a>
        </div>
      </div>
      {/* !Hero Header */}
      {/* About Section */}
      <AboutComponent />
      {/* !About Section */}
      {/* Services Section */}
      <ServicesComponent />
      {/* !Services Section */}
      <Drops />
      {/* Investor Section */}
      <WhyChooseUsComponent />
      {/* !Investor Section */}
      {/* Blog Section */}
      <BlogComponent />
    </Layout>
  );
};
export default HalfSlider;
