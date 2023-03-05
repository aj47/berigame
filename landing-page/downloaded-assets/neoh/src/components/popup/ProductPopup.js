import { Fragment } from "react";

const ProductPopup = ({ open, close, img, title, dec }) => {
  return (
    <Fragment>
      <div className={`neoh_fn_modal product_modal ${open ? "opened" : ""}`}>
        <div className="modal_in">
          <div className="modal_closer">
            <a onClick={() => close()}>
              <img src="svg/cancel.svg" alt="" className="fn__svg" />
            </a>
          </div>
          <div className="modal_content">
            <div className="neoh_fn_product_modal">
              <div className="img_item">
                <img src={img} />
              </div>
              <div className="content_item">
                <div className="neoh_fn_title" data-align="left">
                  <h3 className="fn_title">{title}</h3>
                  <div className="line">
                    <span />
                  </div>
                </div>
                <div className="desc">
                  <p>
                    {dec
                      ? dec
                      : `Suspendisse eu velit est. Cras nec vestibulum quam. Donec
                    tincidunt purus nec enim tincidunt, sit amet facilisis massa
                    laoreet. Integer mollis nec sapien eu lacinia.`}
                  </p>
                </div>
                <div className="buttons">
                  <a
                    href="https://opensea.io/"
                    target="_blank"
                    rel="noreferrer"
                    className="neoh_fn_button opensea"
                  >
                    <span className="icon">
                      <img src="svg/opensea.svg" alt="" className="fn__svg" />
                    </span>
                    <span className="text">View on OpenSea</span>
                  </a>
                  <a
                    href="https://discord.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="neoh_fn_button discord disable"
                  >
                    <span className="icon">
                      <img src="svg/discord.svg" alt="" className="fn__svg" />
                    </span>
                    <span className="text">View on Discord</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Fragment>
  );
};
export default ProductPopup;
