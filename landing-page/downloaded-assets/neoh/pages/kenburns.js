import AboutComponent from "../src/components/AboutComponent";
import BlogComponent from "../src/components/BlogComponent";
import Drops from "../src/components/Drops";
import KendurnsHero from "../src/components/KendurnsHero";
import ServicesComponent from "../src/components/ServicesComponent";
import WhyChooseUsComponent from "../src/components/WhyChooseUsComponent";
import Layout from "../src/layout/Layout";

const Kenburns = () => {
  return (
    <Layout pageName={"Home Kenburns"}>
      <KendurnsHero />
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
export default Kenburns;
