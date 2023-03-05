import Link from "next/link";
const AboutComponent = () => {
  return (
    <section id="about">
      <div className="container">
        {/* About Item #1 */}
        <div className="neoh_fn_about_item">
          <div className="img_item">
            <img src="img/about/1.jpg" alt="" />
          </div>
          <div className="content_item">
            <div className="neoh_fn_title" data-align="left">
              <h3 className="fn_title">The Rise of Neoh</h3>
              <div className="line">
                <span />
              </div>
            </div>
            <div className="desc">
              <p>
                As the first hero of the Neoh Universe, collection has over
                9,999 unique skins drawn from the different missions and
                challenges he faced throughout his life.
              </p>
              <p>
                The artwork has been hand-drawned by Robert Green in the
                traditional anime style and composited by Layla Efiyo.
              </p>
            </div>
            <div className="buttons">
              <a
                href="https://opensea.io/"
                target="_blank"
                rel="noreferrer"
                className="neoh_fn_button"
              >
                <span className="icon">
                  <img src="svg/opensea.svg" alt="" className="fn__svg" />
                </span>
                <span className="text">OpenSea</span>
              </a>
              <a
                href="https://discord.com/"
                target="_blank"
                rel="noreferrer"
                className="neoh_fn_button"
              >
                <span className="icon">
                  <img src="svg/discord.svg" alt="" className="fn__svg" />
                </span>
                <span className="text">Discord</span>
              </a>
            </div>
          </div>
        </div>
        {/* !About Item #1 */}
        {/* About Item #2 */}
        <div className="neoh_fn_about_item reverse">
          <div className="img_item">
            <img src="img/about/2.jpg" alt="" />
          </div>
          <div className="content_item">
            <div className="neoh_fn_title" data-align="left">
              <h3 className="fn_title">High Quality NFT Collection</h3>
              <div className="line">
                <span />
              </div>
            </div>
            <div className="desc">
              <p>
                Simply holding a Neoh will give you access to seasonal airdrops,
                merchandise, physical and digital artworks, collectibles and
                more.
              </p>
              <p>
                We understand the importance of the cross-over between these
                worlds and we truly believe to bridge these two together. Our
                goals will always be for the community - creating, building and
                innovating together with the commmunity.
              </p>
            </div>
            <div className="buttons">
              <Link href="/about">
                <a className="neoh_fn_button only_text">
                  <span className="text">More About US</span>
                </a>
              </Link>
            </div>
          </div>
        </div>
        {/* !About Item #2 */}
      </div>
    </section>
  );
};
export default AboutComponent;
