import { Fragment, useState } from "react";
import ProductPopup from "./popup/ProductPopup";
import Timeline from "./Timeline";

const Drops = () => {
  const [toggle, setToggle] = useState(false);
  const [data, setData] = useState({ img: "", title: "" });
  const dropData = [
    {
      img: "img/drops/1.jpg",
      title: "Neoh #4588",
    },
    {
      img: "img/drops/2.jpg",
      title: "Neoh #4587",
    },
    {
      img: "img/drops/3.jpg",
      title: "Neoh #4586",
    },
    {
      img: "img/drops/4.jpg",
      title: "Neoh #4585",
    },
    {
      img: "img/drops/5.jpg",
      title: "Neoh #4584",
    },
    {
      img: "img/drops/6.jpg",
      title: "Neoh #4583",
    },
  ];

  const onClick = (value) => {
    setData(dropData[value - 1]);
    setToggle(true);
  };

  const { img, title } = data;

  return (
    <Fragment>
      <ProductPopup
        open={toggle}
        close={() => setToggle(false)}
        img={img}
        title={title}
      />
      {/* Drops Section */}
      <section id="drop">
        <div className="container">
          {/* Main Title */}
          <div className="neoh_fn_title">
            <h3 className="fn_title">Our Latest Drops</h3>
            <div className="line">
              <span />
            </div>
          </div>
          {/* !Main Title */}
          {/* Drops List */}
          <div className="neoh_fn_drops">
            <ul>
              <li>
                <div
                  className="item"
                  data-modal-image="img/drops/1.jpg"
                  data-modal-title="Neoh #4588"
                  data-modal-description="Suspendisse eu velit est. Cras nec vestibulum quam. Donec tincidunt purus nec enim tincidunt, sit amet facilisis massa laoreet. Integer mollis nec sapien eu lacinia."
                  data-modal-opensea-url="#"
                  data-modal-discord-url=""
                >
                  <div className="img_holder">
                    <img src="img/drops/1.jpg" alt="" />
                    <a className="full_link" onClick={() => onClick(1)} />
                  </div>
                  <div className="title_holder">
                    <h3 className="fn_title">
                      <a onClick={() => onClick(1)}>Neoh #4588</a>
                    </h3>
                  </div>
                </div>
              </li>
              <li>
                <div
                  className="item"
                  data-modal-image="img/drops/2.jpg"
                  data-modal-title="Neoh #4587"
                  data-modal-description="Suspendisse eu velit est. Cras nec vestibulum quam. Donec tincidunt purus nec enim tincidunt, sit amet facilisis massa laoreet. Integer mollis nec sapien eu lacinia."
                  data-modal-opensea-url=""
                  data-modal-discord-url="#"
                >
                  <div className="img_holder">
                    <img src="img/drops/2.jpg" alt="" />
                    <a onClick={() => onClick(2)} className="full_link" />
                  </div>
                  <div className="title_holder">
                    <h3 className="fn_title">
                      <a onClick={() => onClick(2)}>Neoh #4587</a>
                    </h3>
                  </div>
                </div>
              </li>
              <li>
                <div
                  className="item"
                  data-modal-image="img/drops/3.jpg"
                  data-modal-title="Neoh #4586"
                  data-modal-description="Suspendisse eu velit est. Cras nec vestibulum quam. Donec tincidunt purus nec enim tincidunt, sit amet facilisis massa laoreet. Integer mollis nec sapien eu lacinia."
                  data-modal-opensea-url="#"
                  data-modal-discord-url=""
                >
                  <div className="img_holder">
                    <img src="img/drops/3.jpg" alt="" />
                    <a onClick={() => onClick(3)} className="full_link" />
                  </div>
                  <div className="title_holder">
                    <h3 className="fn_title">
                      <a onClick={() => onClick(3)}>Neoh #4586</a>
                    </h3>
                  </div>
                </div>
              </li>
              <li>
                <div
                  className="item"
                  data-modal-image="img/drops/4.jpg"
                  data-modal-title="Neoh #4585"
                  data-modal-description="Suspendisse eu velit est. Cras nec vestibulum quam. Donec tincidunt purus nec enim tincidunt, sit amet facilisis massa laoreet. Integer mollis nec sapien eu lacinia."
                  data-modal-opensea-url="#"
                  data-modal-discord-url=""
                >
                  <div className="img_holder">
                    <img src="img/drops/4.jpg" alt="" />
                    <a onClick={() => onClick(4)} className="full_link" />
                  </div>
                  <div className="title_holder">
                    <h3 className="fn_title">
                      <a onClick={() => onClick(4)}>Neoh #4585</a>
                    </h3>
                  </div>
                </div>
              </li>
              <li>
                <div
                  className="item"
                  data-modal-image="img/drops/5.jpg"
                  data-modal-title="Neoh #4584"
                  data-modal-description="Suspendisse eu velit est. Cras nec vestibulum quam. Donec tincidunt purus nec enim tincidunt, sit amet facilisis massa laoreet. Integer mollis nec sapien eu lacinia."
                  data-modal-opensea-url="#"
                  data-modal-discord-url=""
                >
                  <div className="img_holder">
                    <img src="img/drops/5.jpg" alt="" />
                    <a onClick={() => onClick(5)} className="full_link" />
                  </div>
                  <div className="title_holder">
                    <h3 className="fn_title">
                      <a onClick={() => onClick(5)}>Neoh #4584</a>
                    </h3>
                  </div>
                </div>
              </li>
              <li>
                <div
                  className="item"
                  data-modal-image="img/drops/6.jpg"
                  data-modal-title="Neoh #4583"
                  data-modal-description="Suspendisse eu velit est. Cras nec vestibulum quam. Donec tincidunt purus nec enim tincidunt, sit amet facilisis massa laoreet. Integer mollis nec sapien eu lacinia."
                  data-modal-opensea-url="#"
                  data-modal-discord-url=""
                >
                  <div className="img_holder">
                    <img src="img/drops/6.jpg" alt="" />
                    <a onClick={() => onClick(6)} className="full_link" />
                  </div>
                  <div className="title_holder">
                    <h3 className="fn_title">
                      <a onClick={() => onClick(6)}>Neoh #4583</a>
                    </h3>
                  </div>
                </div>
              </li>
            </ul>
            {/* Clearfix */}
            <div className="clearfix" />
          </div>
          {/* !Drops List */}
          <Timeline />
        </div>
      </section>
      {/* !Drops Section */}
    </Fragment>
  );
};
export default Drops;
