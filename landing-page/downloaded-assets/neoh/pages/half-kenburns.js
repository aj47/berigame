import AboutComponent from "../src/components/AboutComponent";
import BlogComponent from "../src/components/BlogComponent";
import Drops from "../src/components/Drops";
import HalfKenburnsHero from "../src/components/HalfKenburnsHero";
import ServicesComponent from "../src/components/ServicesComponent";
import WhyChooseUsComponent from "../src/components/WhyChooseUsComponent";
import Layout from "../src/layout/Layout";

const HalfKenburns = () => {
  return (
    <Layout pageName={"Home Half Kenburns"}>
      <HalfKenburnsHero />
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
export default HalfKenburns;
