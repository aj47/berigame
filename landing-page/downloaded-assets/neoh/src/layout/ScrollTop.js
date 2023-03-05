import { Fragment } from "react";

const ScrollTop = () => {
  return (
    <Fragment>
      <a href="#" className="neoh_fn_totop">
        <span className="arrow">
          <img src="svg/right-arr.svg" alt="" className="fn__svg" />
        </span>
        <span className="circle">
          <img src="svg/circle.svg" alt="" className="fn__svg" />
        </span>
      </a>
    </Fragment>
  );
};
export default ScrollTop;
